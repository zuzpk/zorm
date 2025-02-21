#!/usr/bin/env node
import path from "path"
import pc from "picocolors"
import { program } from "commander";
// import fs, { readdirSync } from "fs";
// import { fileURLToPath } from "url";
import { MySqlDriver } from "./drivers/mysql/index.js";
import { checkDirectory } from "./core/index.js";

program
    .option(`-v, --version`)
    .option(`-c, --connection <VALUE>`, `Database Connection String`)
    .option(`-p, --dist`)

program.parse()

const { version, connection, dist: destination } = program.opts();

if ( version ){
    console.log(`ZuzORM v0.1.1`)
    process.exit(1);
}

if ( connection ){
    
    const dist = destination || path.join(`src`, `zorm`)
    
    const _checkDist = checkDirectory(path.join(process.cwd(), dist), true)

    if ( !_checkDist.access ){
        console.log( pc.red(`○ ${_checkDist.message}`) )
        process.exit(1);
    }

    if ( connection.startsWith(`mysql`) ){

        const driver = new MySqlDriver(decodeURIComponent(connection), dist)

        driver.generate();

    }
    else{
        console.log(`Only MySQL is supported for now`)
        process.exit(1);
    }

    

}