import fs from "fs";

export const toPascalCase = (str: string): string => {
    return str.replace(/(^\w|_\w)/g, (match) => match.replace("_", "").toUpperCase());
}

export const mapSqlTypeToTypescript = (sqlType: string): string => {
    if (sqlType.startsWith("int") || sqlType.startsWith("tinyint")) return "number";
    if (sqlType.startsWith("varchar") || sqlType.startsWith("text")) return "string";
    if (sqlType.startsWith("datetime") || sqlType.startsWith("timestamp")) return "Date";
    return "any";
}

export const checkDirectory = (path: string, create: boolean) : { access: boolean, message?: string } => {
    try {
        // Check if the path exists
        if (!fs.existsSync(path)) {
            if ( create )
                fs.mkdirSync( path, { recursive: true } )
            else
                return { access: false, message: `${path} does not exist.\nRun \`zorm -c [DATABASE_CONNECTION_STRING]\``};
        }

        // Check if it's a directory
        const stat = fs.statSync(path);
        if (!stat.isDirectory()) return { access: false, message: `${path} is not a folder.`};

        // Check if it's writable
        try{
            fs.accessSync(path, fs.constants.W_OK);
        }
        catch(e){
            return { access: false, message: `${path} has no write permission.`};
        }
        
        return { access: true };

    } catch (err) {
        return { access: false, message: `Destination folder is not accessible` };
    }
}

export const stackTrace = (_error: string, ...more: string[]) : Error => {

    const error = new Error([_error, ...more].join(` `))
    const lines : string[] = [error.message]
    // const lines : string[] = [`${pc.bgRed(pc.whiteBright(` Zorm `))} ${pc.red(error.message)}`]
    // const regex = /\((\/.*\.[a-zA-Z0-9]+):\d+:\d+\)/;
    // const regex = /(\/.*\.[a-zA-Z0-9]+):\d+:\d+/;
    // error.stack?.split(`\n`)
    //     .forEach((line, index) => {
    //         if ( line.includes(process.cwd()) ){
    //             const match = line.match(regex)
    //             if ( match ){
    //                 const [f, _line, _column] = match[0].split(`:`)
    //                 const rawLine = fs.readFileSync(match[1], `utf8`).split(`\n`)[Number(_line)-1]
    //                 const ls = f.split(`/`)
    //                 lines.push(`${ls[ls.length-3]}/${ls[ls.length-2]}/${ls[ls.length-1]} - ZormError: ${_error}`)
    //                 lines.push(`${pc.bgBlack(pc.white(_line))}\t${rawLine}`)
    //             }
    //         }
    //     })

    return Error(lines.join(`\n`))

}

export const isNumber = (val: any) => /^[+-]?\d+(\.\d+)?$/.test(val)