#!/usr/bin/env node
import { program } from "commander";
import { Pull } from "./core/cli.js";
import pc from "picocolors"

program
    .name("zorm")
    .description("ZuzORM is a lightweight ORM wrapper around TypeORM with support for MySQL.")

/**Version */
program
    .option(`-v, --version`)
    .description("Displays current version of ZuzORM")
    .action(() => {
        const packageJson = require("../package.json")
        console.log(pc.cyan(`ZuzORM v${packageJson.version}`))
        process.exit(1);
    })

program
    .command(`pull`)
    .description(`Pull using DATABASE_URL from .env in project directory`)
    .action(Pull)

program.parse()