#!/usr/bin/env node

import commonjsPlugin from '@chialab/esbuild-plugin-commonjs';
import serve from '@es-exec/esbuild-plugin-serve';
//@ts-ignore
import { parse } from "envfile";
import { BuildOptions, build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { objectify, tryit } from "radash";

declare global {
    interface ImportMeta {
        env: Record<string, string>;
    }
}

type Config = {
    references?: Array<{ module: string, path: string, external?: boolean }>
}
let config: Config | null = null;

const argv = await yargs(hideBin(process.argv))
    .config("config", configPath => {
        try {
            const rawData = fs.readFileSync(configPath, "utf-8");
            const parsed = JSON.parse(rawData)
            config = parsed;
            return parsed;
        } catch {
            return {};
        }
    })
    .default("config", "server.config.json")
    .option("envFile", {
        type: "string",
        default: ".env",
        describe: ".env file from which environment variables will be imported"
    })
    .option("file", {
        alias: "f",
        demandOption: true,
        describe: "index file to be used as source",
        type: "string"
    })
    .option("dist", {
        alias: ["d", "out", "o"],
        default: "dist/index.js",
        describe: "The compiled file name",
        type: "string"
    })
    .option("watch", {
        alias: "w",
        default: false,
        describe: "Recompile and restart app when code changes",
        type: "boolean"
    })
    .option("production", {
        alias: "p",
        default: false,
        description: "When running in production mode the app will be minified, all comments removed (including legal ones) and the node app will not be executed",
        type: "boolean"
    })
    .option("format", {
        default: "esm",
        choices: ["esm", "cjs", "iife"],
        description: "The module format for the out file"
    })
    .option("external", {
        alias: ["e", "ext"],
        array: true,
        default: [],
        type: "string",
        description: "You can mark a file or a package as external to exclude it from your build. Instead of being bundled, the import will be preserved and will be evaluated at run time instead."
    })
    .option("externalDependencies", {
        default: false,
        description: "If true all the dependencies from package.json will be external",
        type: "boolean"
    })
    .option("packageJson", {
        default: "./package.json",
        description: "Package json path",
        type: "string"
    })
    .option("bundleEnvVars", {
        default: false,
        type: "boolean",
        description: "If true the process environment variables (process.env) will be bundled into the dist file. The env variables from import.meta.env will be bundled no matter what."
    })
    .parse();

class DefineValues {
    private env: Record<string, string> = {};

    constructor() {
        this.addProperty("NODE_ENV", argv.production ? "production" : "development", "string", true);
    }

    addProperty(name: string, value: string, type: "string" | "number", process?: boolean) {
        const val = type === "number" ? value : `"${value}"`;

        this.env[`import.meta.env.${name}`] = val;
        if (process) this.env[`process.env.${name}`] = val;
    }

    export() {
        return this.env;
    }
}

async function getPackageJSON(path: string) {
    const [err, rawData] = tryit(fs.readFileSync)(path);
    if (err) {
        if (path === "./package.json") {
            return null;
        } else {
            throw new Error("The package.json file was not found");
        }
    }

    return JSON.parse(rawData.toString()) as {
        dependencies: Record<string, string>,
    };
}

const packageJSON = await getPackageJSON(argv.packageJson);
const externalDependencies = argv.externalDependencies ? Object.keys(packageJSON?.dependencies || {}) : [];

const env = new DefineValues();

const envFile = argv.config ? path.resolve(path.dirname(argv.config), argv.envFile) : argv.envFile;
if (fs.existsSync(envFile)) {
    const envRaw = fs.readFileSync(envFile, "utf-8");
    const entries = parse(envRaw);

    for (const entry in entries) {
        env.addProperty(entry, entries[entry], Number.isNaN(+entries[entry]) ? "string" : "number", argv.bundleEnvVars);

        // const value: string = entries[entry];
        // if (+value) env[`process.env.${entry}`] = value;
        // else env[`process.env.${entry}`] = `"${value}"`;
    }
}

// env["process.env.NODE_ENV"] = argv.production ? `"production"` : `"development"`;

const inputFile = argv.config ? path.resolve(path.dirname(argv.config), argv.file) : argv.file;

const baseOptions = {
    entryPoints: [inputFile],
    outfile: argv.dist,
    platform: "node",
    format: argv.format as BuildOptions["format"],
    bundle: true,
    define: env.export(),
    //@ts-ignore
    alias: objectify((config?.references || []) as Config["references"], reference => reference.module, reference => reference.path),
    plugins: [
        commonjsPlugin(),
        {
            name: "module-paths",
            setup(build) {
                const { modulePaths } = argv as (typeof argv & { modulePaths: { onlyInDev?: boolean, paths: Record<string, string> } });
                if (modulePaths.onlyInDev && argv.production) return;

                const modulesName = Object.keys(modulePaths.paths);
                build.onResolve({ filter: new RegExp(`^(${modulesName.join("|")})`) }, args => {
                    const dir = modulePaths.paths[args.path];
                    if (!dir) return { path: args.path };

                    const fileDir = path.resolve(process.cwd(), dir);
                    let [matchedFile] = fs.globSync([fileDir, `${fileDir}.*`]);

                    if (!matchedFile) {
                        const [matchIndexFile] = fs.globSync(`${fileDir}/index.*`);
                        matchedFile = matchIndexFile;
                    }

                    if (matchedFile) {
                        return { path: matchedFile };
                    }

                    return { path: args.path };
                });
            },
        }
    ],
    external: [...argv.external, ...externalDependencies]
} satisfies BuildOptions

if (argv.production) {
    await build({
        ...baseOptions,
        minify: true,
        minifyIdentifiers: true,
        minifySyntax: true,
        minifyWhitespace: true,
        legalComments: "none",
    });
} else {
    if (argv.watch) {
        const ctx = await context({
            ...baseOptions,
            plugins: [
                ...baseOptions.plugins,
                serve()
            ]
        });

        console.log(`watching ${argv.file}...`);
        await ctx.watch();
    } else {
        await build(baseOptions);
    }
}