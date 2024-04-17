import { parse } from "envfile";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import pkg from "./package.json" with { type: "json" };

function extractEnv(env) {
    const entries = parse(env);
    const envObj = {};

    for (const entry in entries) {
        envObj[`process.env.${entry}`] = entries[entry];
    }

    return envObj;
}

const envFile = fs.readFileSync(".env", "utf-8");
const env = extractEnv(envFile);

const options = {
    entryPoints: ["./src/index.ts"],
    minify: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: "none",
    outfile: path.resolve("dist/index.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    define: env,

    external: [
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.peerDependencies || {})
    ]
}

await build(options);