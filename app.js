import { Client, middleware } from '@line/bot-sdk';
import { permutations } from 'itertools';
import rp from 'request-promise';
import cheerio from 'cheerio';
import express from 'express';

const config = {
    channelId: '1638251402',
    channelSecret: '263f5184acd053d9f3f83d89befbf012',
    channelAccessToken:
        'Q0Y5R1PLj0W7VWoM+bVsrMw6+mUSruXc/xBVCgeprZsHBMGeMmNeKEOceKP3LQyo6F6f6CtYSlSq0NfpskgW0I8IWA/QrHh8opaHhVIbsbP3G3uLPb0U3RYJYWyfqdiZ6Ti0jQcu4qP8M7Xq/IV4GAdB04t89/1O/w1cDnyilFU=',
};

console.log('process.env', process.env);

const client = new Client(config);
const app = express();
const STAGE = {
    INIT: 0,
    WAIT_FOR_CANDIDATES: 1,
    WAIT_FOR_QUESTION: 2,
    END: 3,
};
let stage = STAGE.INIT;
let candidates = '';

app.post('/linewebhook', middleware(config), (req, res) => {
    req.body.events.forEach((event) => {
        const {
            type,
            message,
            source: { userId },
            replyToken,
        } = event;
        if (type === 'message' && message.type === 'text') {
            const text = message.text.trim();
            if (text.toLowerCase() === 'end' || text === '結束') {
                stage = STAGE.END;
            }
            switch (stage) {
                case STAGE.INIT:
                    if (text.toLowerCase() === 'start' || text === '開始') {
                        stage = STAGE.WAIT_FOR_CANDIDATES;
                        client.replyMessage(replyToken, {
                            type: 'text',
                            text: '<< 服務開始 >>\n請輸入候選英文字母：',
                        });
                    } else {
                        client.replyMessage(replyToken, {
                            type: 'text',
                            text: '請輸入"開始"或是"start"以開始服務',
                        });
                    }
                    break;
                case STAGE.WAIT_FOR_CANDIDATES:
                    if (/^[a-zA-Z]+$/.test(text)) {
                        candidates = text;
                        stage = STAGE.WAIT_FOR_QUESTION;
                        client.replyMessage(replyToken, {
                            type: 'text',
                            text: '請輸入題目(輸入.來代表空格)：',
                        });
                    } else {
                        client.replyMessage(replyToken, {
                            type: 'text',
                            text: '輸入不符合格式，請重新輸入',
                        });
                    }
                    break;
                case STAGE.WAIT_FOR_QUESTION:
                    if (/^[a-zA-Z\.]+$/.test(text) || text.indexOf('.') >= 0) {
                        client.replyMessage(replyToken, {
                            type: 'text',
                            text: '查詢中，請稍候......',
                        });
                        findAnswers(text.toLowerCase(), candidates.toLowerCase(), userId);
                    } else {
                        client.replyMessage(replyToken, {
                            type: 'text',
                            text: '輸入不符合格式，請重新輸入',
                        });
                    }
                    break;
                case STAGE.END:
                    candidates = '';
                    stage = STAGE.INIT;
                    client.pushMessage(userId, {
                        type: 'text',
                        text: 'Bye!',
                    });
                    break;
            }
        } else {
            client.replyMessage(replyToken, {
                type: 'text',
                text: '請輸入"開始"或是"start"以開始服務',
            });
        }
    });
});

app.listen(process.env.PORT || 80, () => {
    console.log('[BOT已準備就緒]');
});

const findAnswers = (question, candidates, userId) => {
    const dictUrl = 'https://dictionary.cambridge.org/dictionary/english-chinese-traditional';
    const headers = {
        'User-Agent':
            'User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/56.0.2924.87 Safari/537.36',
    };
    console.log('question', question);
    console.log('candidates', candidates);

    const { blankIndexes, chars } = question.split('').reduce(
        (acc, cur, index) => {
            if (cur === '.') {
                acc.blankIndexes.push(index);
            } else {
                acc.chars.push(cur);
            }
            return acc;
        },
        {
            blankIndexes: [],
            chars: [],
        }
    );

    let filteredCandidates = candidates;
    chars.forEach((char) => {
        filteredCandidates = filteredCandidates.replace(char, '');
    });

    const permArray = permutations(filteredCandidates, blankIndexes.length);
    // Remove the duplicate items
    const permSet = new Set(Array.from(permArray).map((permItem) => permItem.join('')));
    const words = Array.from(permSet).map(mapToWord(question, blankIndexes));
    const promises = words.map(mapToPromise(dictUrl, headers));
    const answers = [];
    Promise.all(promises)
        .then((responses) => {
            responses.forEach(($, index) => {
                if ($('.headword').length) {
                    console.log(`<< ${words[index]} >>`);
                    answers.push(words[index]);
                }
            });
        })
        .then(() => {
            client.pushMessage(userId, {
                type: 'text',
                text:
                    answers.join('\n') +
                    '\n\n-----以上為所有可能的單字-----\n\n請直接輸入下個題目\n或是輸入"end"或是"結束"以離開服務',
            });
        });
};

const mapToWord = (question, blankIndexes) => {
    return (set) => {
        const splitQuestion = question.split('');
        for (const [index, blankIndex] of blankIndexes.entries()) {
            splitQuestion[blankIndex] = set[index];
        }
        return splitQuestion.join('');
    };
};

const mapToPromise = (dictUrl, headers) => {
    return (word) => {
        return rp({
            url: `${dictUrl}/${word}`,
            headers,
            transform: (body) => cheerio.load(body),
        });
    };
};
