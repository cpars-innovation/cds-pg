const format = require('pg-format');


const findMetadata = (model, entity) => {
    return model.definitions[entity];
}

const findColumns = (columns, model) => {
    const metadata = findMetadata(model)
    if (columns[0].ref) {
        return columns
            .filter(col => !col.expand)
            .map((col) => `${col.ref[0]} AS "${col.ref[0]}"`).join(', ');
    }
    return ` ${Object.keys(metadata.keys).map(key => ` ${key} as "${key}"`)} `;
}





/**
 * csn to Postgres' sql compiler
 * @param {Object} query in csn
 * @returns {String} postgresql sql query
 */
function cqn2pgsql(query, model, entity) {
    if (process.env.DEBUG || process.env.CDS_DEBUG) {
        console.info('[cds-pg]', '-', 'query >\n', query)
    }

    let sql = ''
    switch (query.cmd) {
        case 'SELECT': {
            const cqn = query.SELECT

            sql =
                `${query.cmd} ${findColumns(cqn.columns, model, entity)} ` +
                `FROM ${cqn.from.ref[0].split('.').join('_')}`
            if (cqn.where) {
                // <key> = '<value>', e.g. ID='some-guid-here'
                sql += ` WHERE ${cqn.where
                    .map((cond) => {
                        if (cond.ref) {
                            return cond.ref[0]
                        } else if (cond.val) {
                            return `'${cond.val}'`
                        } else {
                            return cond
                        }
                    })
                    .join('')}`
            }
            if (cqn.limit && cqn.limit.rows) {
                sql += ` LIMIT ${cqn.limit.rows.val}`
            }
            if (cqn.limit && cqn.limit.offset) {
                sql += ` OFFSET ${cqn.limit.offset.val}`
            }
            break
        }
        case 'INSERT': {
            const cqn = query.INSERT
            const fields = Object.keys(cqn.entries[0]);
            sql = `${query.cmd} INTO ${query.INSERT.into.split('.').join('_')} ` +
                ` ( ${fields.join(', ')}) VALUES %L `;
            const values = cqn.entries.map(entry => {
                return Object.values(entry).map(value => value);
            })
            return format(sql, values);
        }
        case 'UPDATE': {
            const cqn = query.UPDATE

            sql =
                `${query.cmd} ${cqn.entity.ref[0].split('.').join('_')} ` +
                `SET  ${Object.keys(cqn.with).map(key => ` ${key} = %L `).join(', ')} `;
            sql = format(sql, ...Object.values(cqn.with));

            if (cqn.where) {
                // <key> = '<value>', e.g. ID='some-guid-here'
                sql += ` WHERE ${cqn.where
                    .map((cond) => {
                        if (cond.ref) {
                            return cond.ref[0]
                        } else if (cond.val) {
                            return `'${cond.val}'`
                        } else {
                            return cond
                        }
                    })
                    .join('')}`
            }
            break
        }
        case 'DELETE': {
            const cqn = query.DELETE
            sql =
                `${query.cmd} FROM ${cqn.from.split('.').join('_')} `;
            if (cqn.where) {
                // <key> = '<value>', e.g. ID='some-guid-here'
                sql += ` WHERE ${cqn.where
                    .map((cond) => {
                        if (cond.ref) {
                            return cond.ref[0]
                        } else if (cond.val) {
                            return `'${cond.val}'`
                        } else {
                            return cond
                        }
                    })
                    .join('')}`
            }
            break
        }
        default: {
            break
        }
    }
    if (process.env.DEBUG || process.env.CDS_DEBUG) {
        console.info('[cds-pg]', '-', 'sql > ', sql)
    }
    return sql
}



module.exports = cqn2pgsql
