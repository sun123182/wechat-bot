const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('@wecom/crypto');
const xml2js = require('xml2js');
const axios = require('axios');

// ======== 企业微信配置（与控制台一致） ========
const WECHAT_TOKEN = process.env.WECOM_TOKEN || 'IQLcl5VMI31lenTIoPk6953';
const WECHAT_ENCODING_AES_KEY =
  process.env.WECOM_ENCODING_AES_KEY ||
  'x62C4ZUbz8kGWunRHK8m3t9nyDkzO8zELS3AtcWQ7I';

// ======== 智能表格 / 腾讯文档 Webhook 配置 ========
const SHEET_WEBHOOK_URL =
  process.env.SHEET_WEBHOOK_URL ||
  'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=6iF6Lo6a7HEgpriBc2vmbRc7MihUPMPU1p8mneZwGoG9CCOZTA03aRpFbTfBiFhwRkN0KX0hJxgr3U2PMGwghTWFxUSXX1I4VlvMWq3zdHjX';

// ======== 经验表 & 业务逻辑 ========
const EXPERIENCE_TABLE = {
  1: 15,
  2: 34,
  3: 57,
  4: 92,
  5: 135,
  6: 372,
  7: 560,
  8: 840,
  9: 1242,
  10: 1716,
  11: 2360,
  12: 3216,
  13: 4200,
  14: 5460,
  15: 7050,
  16: 8840,
  17: 11040,
  18: 13716,
  19: 16680,
  20: 20216,
  21: 24402,
  22: 28980,
  23: 34320,
  24: 40512,
  25: 47216,
  26: 54900,
  27: 63666,
  28: 73080,
  29: 83720,
  30: 95700,
  31: 108480,
  32: 122760,
  33: 138666,
  34: 155540,
  35: 174216,
  36: 194832,
  37: 216600,
  38: 240500,
  39: 266682,
  40: 294216,
  41: 324240,
  42: 356916,
  43: 391160,
  44: 428280,
  45: 468450,
  46: 510420,
  47: 555680,
  48: 604416,
  49: 655200,
  50: 709716,
  51: 748608,
  52: 789631,
  53: 832902,
  54: 878545,
  55: 926689,
  56: 977471,
  57: 1031036,
  58: 1087536,
  59: 1147132,
  60: 1209994,
  61: 1276301,
  62: 1346242,
  63: 1420016,
  64: 1497832,
  65: 1579913,
  66: 1666492,
  67: 1757815,
  68: 1854143,
  69: 195575,
  70: 2062925,
  71: 2175973,
  72: 2295216,
  73: 2420993,
  74: 2553663,
  75: 2693603,
  76: 2841212,
  77: 299691,
  78: 316114,
  79: 333437,
  80: 3517093,
  81: 3709829,
  82: 3913127,
  83: 4127566,
  84: 4353756,
  85: 4592341,
  86: 4844001,
  87: 5109452,
  88: 5389449,
  89: 568479,
  90: 5996316,
  91: 6324914,
  92: 6671519,
  93: 7037118,
  94: 7422752,
  95: 7829518,
  96: 8258575,
  97: 8711144,
  98: 9188514,
  99: 9692044,
  100: 10223168,
};

function getUpgradeExperience(level) {
  return EXPERIENCE_TABLE[level] || null;
}

// 解析游戏消息，沿用你之前的规则
function parseGameMessage(message, sender) {
  console.log('原始消息:', message);

  let cleanMessage = message.replace(/@财务账号/g, '').replace(/@财务/g, '').trim();
  console.log('清理后消息:', cleanMessage);

  const accountMatch = cleanMessage.match(/账号\s*(\S+)/);
  const levelMatch = cleanMessage.match(/等级\s*(\d+)/);
  const expStartMatch = cleanMessage.match(/(?:开始|经验开始|开始经验)\s*(\d+)/);
  const expEndMatch = cleanMessage.match(/(?:结束|经验结束|结束经验)\s*(\d+|升级\+?\d+)/);

  if (!accountMatch || !levelMatch || !expStartMatch || !expEndMatch) {
    throw new Error(
      '消息格式不正确，需要包含：账号[角色名] 等级[数字] 开始经验[数字] 结束经验[数字或升级+数字]',
    );
  }

  const roleName = accountMatch[1];
  const level = parseInt(levelMatch[1], 10);
  const expStart = parseInt(expStartMatch[1], 10);
  const expEndStr = expEndMatch[1];

  let expEnd;
  let diff;
  const upgradeMatch = expEndStr.match(/升级\+?(\d+)/);

  if (upgradeMatch) {
    const extraExp = parseInt(upgradeMatch[1], 10);
    const upgradeExpNeeded = getUpgradeExperience(level);
    if (upgradeExpNeeded === null) throw new Error(`找不到等级${level}的升级所需经验数据`);
    diff = Math.round(upgradeExpNeeded / 10000 - expStart + extraExp);
    expEnd = `升级+${extraExp}`;
  } else {
    expEnd = parseInt(expEndStr, 10);
    if (Number.isNaN(expEnd)) {
      throw new Error(`经验结束值必须是数字或"升级+数字"格式，实际值: ${expEndStr}`);
    }
    if (expEnd <= expStart) {
      throw new Error('经验结束值必须大于经验开始值');
    }
    diff = expEnd - expStart;
  }

  let salary;
  if (roleName === 'mao' || roleName === '米露') {
    salary = (diff / 1440) * 10;
  } else if (level < 160) {
    salary = (diff / 1020) * 10;
  } else {
    salary = (diff / 1200) * 10;
  }
  salary = Math.round(salary * 100) / 100;

  const now = new Date();
  const dateNum = parseInt(now.toISOString().slice(8, 10), 10);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[now.getDay()];

  return {
    date: dateNum,
    weekday,
    wechatName: sender,
    roleName,
    level,
    expStart,
    expEnd: expEnd.toString(),
    diff,
    salary,
    note: '',
    photoTime: '正常拍照',
  };
}

// 写入腾讯文档智能表格（沿用你之前的 payload）
async function writeToNewSheet(gameData) {
  if (!SHEET_WEBHOOK_URL) throw new Error('未配置SHEET_WEBHOOK_URL');

  const payload = {
    add_records: [
      {
        values: {
          fOlhsH: gameData.date,
          fPRPMM: [{ text: gameData.weekday }],
          fPaTu6: gameData.wechatName,
          fYjV7x: gameData.roleName,
          fZ3sSb: gameData.level,
          fayciJ: gameData.expStart,
          fe513b: gameData.expEnd,
          fj4ODK: gameData.diff,
          fjpgjh: gameData.salary,
          fssaCv: gameData.note || '',
          fvdx3A: [{ text: gameData.photoTime }],
        },
      },
    ],
  };

  console.log('发送到新表格:', JSON.stringify(payload, null, 2));

  const response = await axios.post(SHEET_WEBHOOK_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  console.log('表格写入成功:', response.data);
  return response.data;
}

// ======== 帮助函数：解析 XML ========
function parseXml(xml) {
  return new Promise((resolve, reject) => {
    xml2js.parseString(
      xml,
      { explicitArray: false, trim: true },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      },
    );
  });
}

// ======== 创建 Express 应用 ========
const app = express();

// 健康检查 + 本地调试
app.get('/test', (req, res) => {
  res.json({ status: 'ok', message: 'wechat bot server is running' });
});

// 企业微信智能机器人回调：body 是 XML，里面 Encrypt 解密后通常是 JSON 字符串
app.use('/callback', bodyParser.text({ type: '*/*', limit: '2mb' }));

// GET：URL 验证
app.get('/callback', (req, res) => {
  try {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    if (!msg_signature || !timestamp || !nonce || !echostr) {
      return res.status(400).send('missing query params');
    }

    const signature = crypto.getSignature(WECHAT_TOKEN, timestamp, nonce, echostr);
    if (signature !== msg_signature) {
      console.error('[GET] signature mismatch', { msg_signature, signature });
      return res.status(401).send('invalid signature');
    }

    const { message } = crypto.decrypt(WECHAT_ENCODING_AES_KEY, echostr);
    console.log('[GET] verify ok, echostr decrypted:', message);
    return res.send(message);
  } catch (err) {
    console.error('[GET] callback error', err);
    return res.status(500).send('server error');
  }
});

// POST：真正的消息处理
app.post('/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    const rawBody = req.body;

    if (!msg_signature || !timestamp || !nonce) {
      return res.status(400).send('missing query params');
    }
    if (!rawBody) {
      return res.status(400).send('empty body');
    }

    console.log('[POST] raw body:', rawBody);

    const parsed = await parseXml(rawBody);
    const encrypt = parsed?.xml?.Encrypt;
    if (!encrypt) {
      console.error('[POST] no Encrypt field');
      return res.status(400).send('no Encrypt');
    }

    const signature = crypto.getSignature(WECHAT_TOKEN, timestamp, nonce, encrypt);
    if (signature !== msg_signature) {
      console.error('[POST] signature mismatch', { msg_signature, signature });
      return res.status(401).send('invalid signature');
    }

    const { message } = crypto.decrypt(WECHAT_ENCODING_AES_KEY, encrypt);
    console.log('[POST] decrypted plaintext:', message);

    let content = null;
    let sender = '未知用户';

    // 1. 优先按 JSON（智能机器人）解析
    try {
      const json = JSON.parse(message);
      console.log('[POST] parsed JSON:', JSON.stringify(json, null, 2));
      if (json.text && json.text.content) {
        content = json.text.content;
        sender = json.from?.userid || '未知用户';
      }
    } catch (e) {
      console.log('[POST] plaintext is not valid JSON, will try XML');
    }

    // 2. 兼容普通应用 XML 文本消息
    if (!content) {
      try {
        const xmlObj = await parseXml(message);
        const msgType = xmlObj?.xml?.MsgType;
        const xmlContent = xmlObj?.xml?.Content;
        console.log('[POST] fallback XML msgType:', msgType, 'content:', xmlContent);
        if (msgType === 'text' && xmlContent) {
          content = xmlContent;
        }
      } catch (e) {
        console.log('[POST] fallback XML parse failed:', e.message);
      }
    }

    if (!content) {
      console.log('[POST] no content found in message, ignore');
      return res.send('success');
    }

    console.log('[POST] final content:', content, 'sender:', sender);

    try {
      const gameData = parseGameMessage(content, sender);
      console.log('解析的游戏数据:', gameData);
      await writeToNewSheet(gameData);
    } catch (parseErr) {
      console.error('解析或写表失败:', parseErr.message);
    }

    return res.send('success');
  } catch (err) {
    console.error('[POST] callback error', err);
    return res.status(500).send('server error');
  }
});

// Render 会注入 PORT
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`游戏数据记录系统启动，端口: ${PORT}`);
  console.log('回调路径: /callback');
  console.log(`表格 Webhook: ${SHEET_WEBHOOK_URL ? '已配置' : '未配置'}`);
});

