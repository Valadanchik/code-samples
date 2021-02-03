'use strict';

const {
    Worker,
    isMainThread,
    workerData,
    parentPort
} = require('worker_threads');
const keywords = require('./../db-queries/keywords');
const axios = require('axios');
const moment = require('moment');

const log4js = require('log4js');
log4js.configure({
    appenders: { domainLog: { type: 'file', filename: 'logs.txt' } },
    categories: { default: { appenders: ['domainLog'], level: 'error' } }
});

function realAPI() {
    const params = {
        api_key: process.env.API_KEY,
        q: workerData.keyword,
        location: workerData.region,
        device: workerData.platform,
        gl: workerData.gl,
        hl: workerData.hl,
        google_domain: workerData.google_domain,
        page: "1",
        num: "100"
    };

    axios.get('https://api.example.com/search', { params })
        .then(async response => {
            // JSON.stringify(response.data, 0, 2);
            let responseData = response.data;

            let keywords_on_first_page = 0;
            let keywords_visible_on_search = 0;
            let position = 0;
            let tmpResult = null;
            let competitorDomains = workerData.competitorDomains;
            let competitorPositions = {};
            competitorDomains.map(competitorDomain => {
                competitorPositions[competitorDomain.domain] = 0;
            })

            if (responseData.organic_results) {
                for (let i = 0; i < responseData.organic_results.length && i < 100; i++) {
                    let domainHostname = responseData.organic_results[i].domain;
                    domainHostname = domainHostname.replace(new RegExp("https?\:\/\/", "gm"), "");
                    domainHostname = domainHostname.replace(new RegExp("www\.", "gm"), "");
                    domainHostname = domainHostname.replace(new RegExp("\/.+", "gm"), "");

                    competitorDomains.map(competitorDomain => {
                        if (domainHostname === competitorDomain.domain) {
                            competitorPositions[domainHostname] = i + 1;
                        }
                    });

                    if (position === 0 && domainHostname === workerData.domain) {
                        position = i + 1;
                        tmpResult = responseData.organic_results[i];
                        if (tmpResult.position <= 10) {
                            keywords_on_first_page++;
                        }
                        keywords_visible_on_search++;
                    }
                }
            }

            await keywords.createReport(workerData, position, tmpResult, workerData.nowTime);

            const competitorDetail = await keywords.competitorDetailByUserId(workerData.user_id);
            if (competitorDetail) {
                await keywords.createCompetitorKeywordPosition(workerData, competitorDetail.dataValues, position);

                const now = moment();
                parentPort.postMessage({
                    domain: workerData.domain,
                    user_id: workerData.user_id,
                    startedAt: now.format('YYYY-MM-DD-hh:mm:ss'),
                    keywords_on_first_page,
                    keywords_visible_on_search,
                    position,
                    competitorPositions,
                    competitorDetailData: competitorDetail.dataValues,
                });
            }
        })
        .catch(err => {
            // console.error(err);
            const logger = log4js.getLogger('domainLog');
            logger.error(err);
        });
}

function fakeAPI() {
    setTimeout(async function () {
        const responseData = require('./../example/' + workerData.keyword + '.json');

        let keywords_on_first_page = 0;
        let keywords_visible_on_search = 0;
        let position = 0;
        let tmpResult = null;

        if (responseData.organic_results) {
            for (let i = 0; i < responseData.organic_results.length && i < 100; i++) {

                let domainHostname = responseData.organic_results[i].domain;
                domainHostname = domainHostname.replace(new RegExp("https?\:\/\/", "gm"), "");
                domainHostname = domainHostname.replace(new RegExp("www\.", "gm"), "");
                domainHostname = domainHostname.replace(new RegExp("\/.+", "gm"), "");

                if (domainHostname === workerData.domain) {
                    position = i + 1;
                    tmpResult = responseData.organic_results[i];
                    if (tmpResult.position <= 10) {
                        keywords_on_first_page++;
                    }
                    keywords_visible_on_search++;
                    break;
                }
            }
        }

        await keywords.createReport(workerData, position, tmpResult, workerData.nowTime);

        const competitorDetail = await keywords.competitorDetailByUserId(workerData.user_id);
        if (competitorDetail) {
            await keywords.createCompetitorKeywordPosition(workerData, competitorDetail.dataValues, position);

            const now = moment();
            parentPort.postMessage({
                domain: workerData.domain,
                user_id: workerData.user_id,
                startedAt: now.format('YYYY-MM-DD-hh:mm:ss'),
                keywords_on_first_page,
                keywords_visible_on_search,
                position,
                competitorDetailData: competitorDetail.dataValues,
            });
        }

    }, 3000);
}
