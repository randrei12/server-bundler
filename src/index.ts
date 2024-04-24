#!/usr/bin/env node

import commonjsPlugin from '@chialab/esbuild-plugin-commonjs';
import serve from '@es-exec/esbuild-plugin-serve';
import { parse } from "envfile";
import { BuildOptions, build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const argv = await yargs(hideBin(process.argv))
    .config("config", configPath => {
        try {
            const rawData = fs.readFileSync(configPath, "utf-8");
            return JSON.parse(rawData);
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
    .parse();

let env = {};

const envFile = argv.config ? path.resolve(path.dirname(argv.config), argv.envFile) : argv.envFile;
if (fs.existsSync(envFile)) {
    const envRaw = fs.readFileSync(envFile, "utf-8");
    const entries = parse(envRaw);

    for (const entry in entries) {
        const value: string = entries[entry];
        if (+value) env[`process.env.${entry}`] = value;
        else env[`process.env.${entry}`] = `"${value}"`;
    }
}

env["process.env.NODE_ENV"] = argv.production ? "production" : "development";

const inputFile = argv.config ? path.resolve(path.dirname(argv.config), argv.file) : argv.file
    
const baseOptions = {
    entryPoints: [inputFile],
    outfile: argv.dist,
    platform: "node",
    format: argv.format as BuildOptions["format"],
    bundle: true,
    define: env,
    plugins: [
        commonjsPlugin()
    ]
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