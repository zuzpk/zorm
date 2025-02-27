import fs, { existsSync } from "fs"
import path from "path"
import pc from "picocolors"
import { checkDirectory } from "./index.js"
import { MySqlDriver } from "../drivers/mysql"

export const buildEntities = (connection: string, dist?: string) => {

    dist = dist || path.join(`src`, `zorm`)
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
        console.log(`○ Only MySQL is supported for now`)        
        process.exit(1);
    }

    
}

/** 
* Pull using DATABASE_URL from .env in project directory
**/ 
export const Pull = () => {

    const env = path.join(process.cwd(), `.env`)
    if ( !existsSync( env ) ){
        console.log( pc.red( `○ ".env" not exists. Create .env and add DATABASE_URL="connection_string"` ) )
        return;
    } 
    
    const raw = fs.readFileSync(env, `utf8`).split(`\n`).filter((line) => line.startsWith(`DATABASE_URL`))
    
    if ( raw.length == 0 ){
        console.log( pc.red( `○ DATABASE_URL not found in ".env". Add DATABASE_URL="connection_string"` ) )
        return;
    } 

    buildEntities(raw[0].trim().replace(/DATABASE_URL=|"|"/g, ``))

}