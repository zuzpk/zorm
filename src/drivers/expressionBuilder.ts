import { ObjectLiteral } from "typeorm";

class ZormExprBuilder<T extends ObjectLiteral> {

    private _parts: string[] = [];
    private _params: Record<string, any> = {};
    private _paramIdx = 0;
    private _alias: string;
    private static globalParamIdx = 0;

    constructor(
        alias?: string,
        parent?: { params: Record<string, any>; idx: number }
    ) {
        this._alias = alias ? `${alias}.` : ``;
        this._paramIdx = parent ? parent.idx : 0;
        this._params = parent ? parent.params : {};
    }

    field(col: keyof T | string): this {
        this._parts.push(`${this._alias}${String(col)}`);
        return this;
    }

    equals(value: any): this {
        const key = `p${this._paramIdx++}`;
        this.append(` = :${key}`);
        // this._parts[this._parts.length - 1] += ` = :${key}`;
        this._params[key] = value;
        return this;
    }

    append(extra: string): this {
        if (this._parts.length === 0) throw new Error("Cannot append to empty expression");
        this._parts[this._parts.length - 1] += extra;
        return this;
    }
    
    wrap(wrapper: (expr: string) => string): this {
        if (this._parts.length === 0) throw new Error("Cannot wrap empty expression");
        this._parts[this._parts.length - 1] = wrapper(this._parts[this._parts.length - 1]);
        return this;
    }

    exists(sub: (q: ZormExprBuilder<T>) => ZormExprBuilder<T>): this {
        const subQ = new ZormExprBuilder<T>(undefined, { params: this._params, idx: this._paramIdx });
        sub(subQ);
        // const { expression, param } = subQ.toExpression();
        this._parts.push(`EXISTS (${subQ.buildExpression()})`);
        // Object.assign(this._params, param);
        this._paramIdx = subQ._paramIdx;
        return this;
    }

    select(expr: string): this {
        this._parts.push(`SELECT ${expr}`);
        return this;
    }

    from(table: string, alias: string): this {
        this._parts.push(`FROM ${table} ${alias}`);
        this._alias = alias;
        return this;
    }

    where(cond: Record<string, any>): this {
        const whereParts: string[] = [];
        for (const [k, v] of Object.entries(cond)) {
        const key = `p${this._paramIdx++}`;
        whereParts.push(`${k} = :${key}`);
            this._params[key] = v;
        }
        this._parts.push(`WHERE ${whereParts.join(' AND ')}`);
        return this;
    }

    // or(sub: ZormExprBuilder<any> | { expression: string; param: Record<string, any> }): this {
    //     const { expression, param } = 'toExpression' in sub ? sub.toExpression() : sub;
    //     this._parts.push(this._parts.length === 0 ? expression : `OR ${expression}`);
    //     Object.assign(this._params, param);
    //     return this;
    // }
    or(): this {
        this._parts.push(`OR`);
        return this;
    }

    and(): this {
        this._parts.push(`AND`);
        return this;
    }

    group() { 
        return this.wrap(e => `(${e})`); 
    }

    fromUnixTime(): this {
        this.wrap(expr => `FROM_UNIXTIME(${expr})`);
        return this;
    }

    date(): this {
        this.wrap(expr => `DATE(${expr})`);
        return this;
    }

    substring(column: keyof T | string, delimiter: string, index: number): this {
        this._parts = [`SUBSTRING_INDEX(${this._alias}${String(column)}, '${delimiter}', ${index})`];
        return this;
    }

    toExpression(): { expression: string; param: Record<string, any> } {
        return { expression: this._parts.join(' '), param: this._params };
    }

    buildExpression() { 
        return this.toExpression().expression; 
    }

    buildParams(){ 
        return this.toExpression().param; 
    }

}

export default ZormExprBuilder