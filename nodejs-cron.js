'use strict';

const CronJob = require('cron').CronJob;
const runThreads = require('./workers/main');

const log4js = require('log4js');
log4js.configure({
    appenders: { domainLog: { type: 'file', filename: 'logs.txt' } },
    categories: { default: { appenders: ['domainLog'], level: 'error' } }
});

class Cron {
    static async started() {
        // eslint-disable-next-line no-new
        await new CronJob(
            '0 * * * *', // TODO: set cron time period for production (1 day for example)
            () => {
                try {
                    runThreads();
                } catch (err) {
                    const logger = log4js.getLogger('domainLog');
                    logger.error(err);
                }
            },
            null,
            true
        );
    }
}

module.exports = Cron;
