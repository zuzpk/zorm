import { ObjectLiteral } from "typeorm";

class ZormExprBuilder<T extends ObjectLiteral> {
    private _expression: string = "";
    private _param: Record<string, any> = {};
    private _paramIndex = 0;

    field(column: keyof T | string): this {
        this._expression = String(column);
        return this;
    }

    fromUnixTime(): this {
        this._expression = `FROM_UNIXTIME(${this._expression})`;
        return this;
    }

    date(): this {
        this._expression = `DATE(${this._expression})`;
        return this;
    }

    substring(column: keyof T | string, delimiter: string, index: number): this {
        this._expression = `SUBSTRING_INDEX(${String(column)}, '${delimiter}', ${index})`;
        return this;
    }

    append(extra: string): this {
        this._expression = `${this._expression}${extra}`;
        return this;
    }

    wrap(wrapper: (expr: string) => string): this {
        this._expression = wrapper(this._expression);
        return this;
    }

    equals(value: string | number | boolean): { expression: string; param: Record<string, any> } {
        const paramKey = `param${this._paramIndex++}`;
        this._param[paramKey] = value;
        return {
            expression: `${this._expression} = :${paramKey}`,
            param: this._param,
        };
    }

    buildExpression(): string {
        return this._expression;
    }

    buildParam(): Record<string, any> {
        return this._param;
    }
}

export default ZormExprBuilder