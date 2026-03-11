const express = require('express');
const crypto = require('@wecom/crypto');
const axios = require('axios');

// ---------- 配置（与企业微信、智能表格后台一致）----------
const TOKEN = process.env.WECOM_TOKEN || 'IQCLf5VMl31IenTIoPk6953';
const AES_KEY = process.env.WECOM_ENCODING_AES_KEY || 'x62C4zUbz8kGWunRHkN8m3t9nyDkzO8zELS3AtcWQ7f';
const SHEET_WEBHOOK =
  process.env.SHEET_WEBHOOK_URL ||
  'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=1V8oeRYw2EhwSrkhRkY5LkAbJuQRIGO96pMrj7CKbtrsVBkyfdmfhtvgtpoif0YjEKcACNe4ukyDmxgpIHSWH0vkP7wpz5aRbqNJQ51iK8fI';

// ---------- 1~200 级升级所需经验 ----------
const EXP_TABLE = {
  1: 15, 2: 34, 3: 57, 4: 92, 5: 135, 6: 372, 7: 560, 8: 840, 9: 1242, 10: 1716,
  11: 2360, 12: 3216, 13: 4200, 14: 5460, 15: 7050, 16: 8840, 17: 11040, 18: 13716, 19: 16680, 20: 20216,
  21: 24402, 22: 28980, 23: 34320, 24: 40512, 25: 47216, 26: 54900, 27: 63666, 28: 73080, 29: 83720, 30: 95700,
  31: 108480, 32: 122760, 33: 138666, 34: 155540, 35: 174216, 36: 194832, 37: 216600, 38: 240500, 39: 266682, 40: 294216,
  41: 324240, 42: 356916, 43: 391160, 44: 428280, 45: 468450, 46: 510420, 47: 555680, 48: 604416, 49: 655200, 50: 709716,
  51: 748608, 52: 789631, 53: 832902, 54: 878545, 55: 926689, 56: 977471, 57: 1031036, 58: 1087536, 59: 1147132, 60: 1209994,
  61: 1276301, 62: 1346242, 63: 1420016, 64: 1497832, 65: 1579913, 66: 1666492, 67: 1757815, 68: 1854143, 69: 1955750, 70: 2062925,
  71: 2175973, 72: 2295216, 73: 2420993, 74: 2553663, 75: 2693603, 76: 2841212, 77: 2996910, 78: 3161140, 79: 3334370, 80: 3517093,
  81: 3709829, 82: 3913127, 83: 4127566, 84: 4353756, 85: 4592341, 86: 4844001, 87: 5109452, 88: 5389449, 89: 5684790, 90: 5996316,
  91: 6324914, 92: 6671519, 93: 7037118, 94: 7422752, 95: 7829518, 96: 8258575, 97: 8711144, 98: 9188514, 99: 9692044, 100: 10223168,
  101: 10783397, 102: 11374327, 103: 11997640, 104: 12655110, 105: 13348610, 106: 14080113, 107: 14851703, 108: 15665576, 109: 16524049, 110: 17429566,
  111: 18384706, 112: 19392187, 113: 20454878, 114: 21575805, 115: 22758159, 116: 24005306, 117: 25320796, 118: 26708375, 119: 28171993, 120: 29715818,
  121: 31344244, 122: 33061908, 123: 34873700, 124: 36784778, 125: 38800583, 126: 40926854, 127: 43169645, 128: 45535341, 129: 48030677, 130: 50662758,
  131: 53439077, 132: 56367538, 133: 59456479, 134: 62714694, 135: 66151459, 136: 69776558, 137: 73600313, 138: 77633610, 139: 81887931, 140: 86375389,
  141: 91108760, 142: 96101520, 143: 101367883, 144: 106922842, 145: 112782213, 146: 118962678, 147: 125481832, 148: 132358236, 149: 139611467, 150: 147262175,
  151: 155332142, 152: 163844343, 153: 172823012, 154: 182293713, 155: 192283408, 156: 202820538, 157: 213935103, 158: 225658746, 159: 238024845, 160: 251068606,
  161: 264827165, 162: 279339693, 163: 294647508, 164: 310794191, 165: 327825712, 166: 345790561, 167: 364739883, 168: 384727628, 169: 405810702, 170: 428049128,
  171: 451506220, 172: 476248760, 173: 502347192, 174: 529875818, 175: 558913012, 176: 589541445, 177: 621848316, 178: 655925603, 179: 691870326, 180: 729784819,
  181: 769777027, 182: 811960808, 183: 856456260, 184: 903390063, 185: 952895838, 186: 1005114529, 187: 1060194805, 188: 1118293480, 189: 1179575962, 190: 1244216724,
  191: 1312399800, 192: 1384319309, 193: 1460180007, 194: 1540197871, 195: 1624600714, 196: 1713628833, 197: 1807535693, 198: 1906588648, 199: 2011069705, 200: 2121276324,
};

function expForLevel(level) {
  return EXP_TABLE[level] ?? null;
}

// 解析：账号xxx 等级n 开始经验xxx 结束经验xxx（或 结束升级+xxx）
function parseMessage(text, sender) {
  const raw = (text || '').replace(/@财务账号/g, '').replace(/@财务/g, '').trim();
  const account = raw.match(/账号\s*(\S+)/)?.[1];
  const level = parseInt(raw.match(/等级\s*(\d+)/)?.[1], 10);
  const startStr = raw.match(/(?:开始|经验开始|开始经验)\s*(\d+)/)?.[1];
  const endStr = raw.match(/(?:结束|经验结束|结束经验)\s*(\d+|升级\+?\d+)/)?.[1];

  if (!account || !level || !startStr || !endStr) {
    throw new Error('格式需包含：账号xxx 等级n 开始经验n 结束经验n（或结束升级+n）');
  }

  const expStart = parseInt(startStr, 10);
  const upgradeMatch = endStr.match(/升级\+?(\d+)/);
  let expEnd, diff;

  if (upgradeMatch) {
    const extra = parseInt(upgradeMatch[1], 10);
    const need = expForLevel(level);
    if (need == null) throw new Error(`无等级${level}经验数据`);
    diff = Math.round(need / 10000 - expStart + extra);
    expEnd = `升级+${extra}`;
  } else {
    expEnd = parseInt(endStr, 10);
    if (Number.isNaN(expEnd) || expEnd <= expStart) throw new Error('结束经验需大于开始经验');
    diff = expEnd - expStart;
  }

  let salary;
  if (account === 'mao' || account === '米露') salary = (diff / 1440) * 10;
  else if (level < 160) salary = (diff / 1020) * 10;
  else salary = (diff / 1200) * 10;
  salary = Math.round(salary * 100) / 100;

  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return {
    date: now.getDate(),
    weekday: weekdays[now.getDay()],
    wechatName: sender,
    roleName: account,
    level,
    expStart,
    expEnd: String(expEnd),
    diff,
    salary,
    note: '',
    photoTime: '正常拍照',
  };
}

async function appendSheet(row) {
  const body = {
    schema: {
      fOlhsH: '日期', fPRPMM: '星期', fPaTu6: '微信名称', fYjV7x: '角色名称',
      fZ3sSb: '等级', fayciJ: '经验值（开始）', fe513b: '经验值（结束）',
      fj4ODK: '差值', fjpgjh: '工资', fssaCv: '备注', fvdx3A: '文本11',
    },
    add_records: [{
      values: {
        fOlhsH: row.date,
        fPRPMM: [{ text: row.weekday }],
        fPaTu6: row.wechatName,
        fYjV7x: row.roleName,
        fZ3sSb: row.level,
        fayciJ: row.expStart,
        fe513b: row.expEnd,
        fj4ODK: row.diff,
        fjpgjh: row.salary,
        fssaCv: row.note || '',
        fvdx3A: [{ text: row.photoTime }],
      },
    }],
  };
  const { data } = await axios.post(SHEET_WEBHOOK, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  return data;
}

// ---------- 服务 ----------
const app = express();

app.use((req, res, next) => {
  console.log('[请求]', req.method, req.url);
  next();
});

app.get('/test', (req, res) => {
  res.json({ ok: true, msg: 'wechat bot running' });
});

// 回调只收 JSON body（智能机器人标准格式）
app.use('/callback', express.json({ limit: '2mb' }));

app.get('/callback', (req, res) => {
  try {
    const q = req.query;
    const msgSig = q.msg_signature;
    const ts = q.timestamp;
    const nonce = q.nonce;
    let echostr = q.echostr;
    if (!msgSig || !ts || !nonce || !echostr) {
      return res.status(400).send('missing params');
    }
    echostr = decodeURIComponent(echostr);
    const sig = crypto.getSignature(TOKEN, ts, nonce, echostr);
    if (sig !== msgSig) {
      console.error('[GET] 签名不符');
      return res.status(401).send('bad signature');
    }
    const { message } = crypto.decrypt(AES_KEY, echostr);
    console.log('[GET] 验证通过, echostr明文:', message);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    return res.send(message);
  } catch (e) {
    console.error('[GET] 错误:', e.message);
    return res.status(500).send('error');
  }
});

app.post('/callback', async (req, res) => {
  try {
    const q = req.query;
    const msgSig = q.msg_signature;
    const ts = q.timestamp;
    const nonce = q.nonce;
    if (!msgSig || !ts || !nonce) {
      return res.status(400).send('missing params');
    }
    const body = req.body;
    const encrypt = body && (body.encrypt || body.Encrypt);
    if (!encrypt) {
      console.error('[POST] 无 encrypt');
      return res.status(400).send('no encrypt');
    }
    const sig = crypto.getSignature(TOKEN, ts, nonce, encrypt);
    if (sig !== msgSig) {
      console.error('[POST] 签名不符');
      return res.status(401).send('bad signature');
    }
    const { message } = crypto.decrypt(AES_KEY, encrypt);
    console.log('[POST] 解密成功');

    const msg = (function () {
      try {
        return JSON.parse(message);
      } catch (_) {
        return null;
      }
    })();
    if (!msg || !msg.text || !msg.text.content) {
      console.log('[POST] 非文本或无 content，跳过');
      return res.send('success');
    }
    const content = msg.text.content;
    const sender = (msg.from && msg.from.userid) || '未知';
    console.log('[POST] 内容:', content, '发件人:', sender);

    const row = parseMessage(content, sender);
    console.log('[POST] 解析结果:', row);
    await appendSheet(row);
    console.log('[POST] 表格已写入');
    return res.send('success');
  } catch (e) {
    console.error('[POST] 错误:', e.message);
    return res.status(500).send('error');
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('服务已启动 端口:', port);
  console.log('回调: /callback  表格Webhook:', SHEET_WEBHOOK ? '已配置' : '未配置');
});
