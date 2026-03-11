const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json({ type: '*/*' }));

const SHEET_WEBHOOK_URL = 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=6iF6Lo6a7HEgpriBc2vmbRc7MihUPMPU1p8mneZwGoG9CCOZTA03aRpFbTfBiFhwRkN0KX0hJxgr3U2PMGwghTWFxUSXX1I4VlvMWq3zdHjX';
const WECOM_TOKEN = process.env.WECOM_TOKEN || 'IQCLf5VMl31IenTIoPk6953';
const WECOM_ENCODING_AES_KEY = process.env.WECOM_ENCODING_AES_KEY || 'x62C4zUbz8kGWunRHkN8m3t9nyDkzO8zELS3AtcWQ7f';

// 经验表数据（1-200级）
const EXPERIENCE_TABLE = {
  1:15,2:34,3:57,4:92,5:135,6:192,7:264,8:352,9:456,10:578,11:718,12:876,13:1054,14:1252,15:1470,
  16:1708,17:1968,18:2250,19:2554,20:2880,21:3230,22:3604,23:4002,24:4424,25:4872,26:5346,27:5846,
  28:6372,29:6926,30:7508,31:8118,32:8756,33:9424,34:10122,35:10850,36:11608,37:12398,38:13220,
  39:14074,40:14960,41:15880,42:16834,43:17822,44:18844,45:19900,46:20992,47:22120,48:23284,49:24484,
  50:25722,51:26998,52:28312,53:29664,54:31056,55:32488,56:33960,57:35472,58:37026,59:38622,60:40260,
  61:41940,62:43664,63:45432,64:47244,65:49100,66:51000,67:52946,68:54938,69:56976,70:59060,71:61192,
  72:63372,73:65600,74:67876,75:70200,76:72574,77:74998,78:77472,79:79996,80:82570,81:85196,82:87874,
  83:90604,84:93386,85:96220,86:99108,87:102050,88:105046,89:108096,90:111200,91:114360,92:117576,
  93:120848,94:124176,95:127560,96:131002,97:134502,98:138060,99:141676,100:145350,101:149084,102:152878,
  103:156732,104:160646,105:164620,106:168656,107:172754,108:176914,109:181136,110:185420,111:189768,
  112:194180,113:198656,114:203196,115:207800,116:212470,117:217206,118:222008,119:226876,120:231810,
  121:236812,122:241882,123:247020,124:252226,125:257500,126:262844,127:268258,128:273742,129:279296,
  130:284920,131:290616,132:296384,133:302224,134:308136,135:314120,136:320178,137:326310,138:332516,
  139:338796,140:345150,141:351580,142:358086,143:364668,144:371326,145:378060,146:384872,147:391762,
  148:398730,149:405776,150:412900,151:420104,152:427388,153:434752,154:442196,155:449720,156:457326,
  157:465014,158:472784,159:480636,160:488570,161:496588,162:504690,163:512876,164:521146,165:529500,
  166:537940,167:546466,168:555078,169:563776,170:572560,171:581432,172:590392,173:599440,174:608576,
  175:617800,176:627114,177:636518,178:646012,179:655596,180:665270,181:675036,182:684894,183:694844,
  184:704886,185:715020,186:725248,187:735570,188:745986,189:756496,190:767100,191:777800,192:788596,
  193:799488,194:810476,195:821560,196:832742,197:844022,198:855400,199:866876,200:878450
};

// 工具函数
function getSignature(token, timestamp, nonce, encryptedMsg) {
  const str = [token, timestamp, nonce, encryptedMsg].sort().join('');
  return crypto.createHash('sha1').update(str).digest('hex');
}

function decryptMsg(encrypted, encodingAESKey) {
  if (!encodingAESKey || encodingAESKey.length !== 43) {
    throw new Error('EncodingAESKey必须是43位');
  }
  const key = Buffer.from(encodingAESKey + '=', 'base64');
  if (key.length !== 32) throw new Error('解码后的Key长度必须是32字节');
  const iv = key.slice(0, 16);
  const encryptedBuffer = Buffer.from(encrypted, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encryptedBuffer);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  decrypted = decrypted.slice(16);
  const msgLength = decrypted.readUInt32BE(0);
  return decrypted.slice(4, 4 + msgLength).toString('utf8');
}

function getUpgradeExperience(level) {
  return EXPERIENCE_TABLE[level] || null;
}

function parseGameMessage(message, sender) {
  let cleanMessage = message.replace(/@财务账号/g, '').replace(/@财务/g, '').trim();
  console.log('清理后消息:', cleanMessage);
  
  const accountMatch = cleanMessage.match(/账号\s*(\S+)/);
  const levelMatch = cleanMessage.match(/等级\s*(\d+)/);
  const expStartMatch = cleanMessage.match(/经验开始\s*(\d+)/);
  const expEndMatch = cleanMessage.match(/经验结束\s*(\S+)/);
  
  if (!accountMatch || !levelMatch || !expStartMatch || !expEndMatch) {
    throw new Error('消息格式不正确');
  }
  
  const roleName = accountMatch[1];
  const level = parseInt(levelMatch[1], 10);
  const expStart = parseInt(expStartMatch[1], 10);
  const expEndStr = expEndMatch[1];
  
  let expEnd, diff;
  const upgradeMatch = expEndStr.match(/升级\+(\d+)/);
  
  if (upgradeMatch) {
    const extraExp = parseInt(upgradeMatch[1], 10);
    const upgradeExpNeeded = getUpgradeExperience(level);
    if (upgradeExpNeeded === null) throw new Error(`找不到等级${level}的升级所需经验数据`);
    diff = (upgradeExpNeeded - expStart) + extraExp;
    expEnd = `升级+${extraExp}`;
    console.log(`升级计算: 等级${level}升级需${upgradeExpNeeded}, 开始${expStart}, 额外${extraExp}, 差值${diff}`);
  } else {
    expEnd = parseInt(expEndStr, 10);
    if (isNaN(expEnd)) throw new Error('经验结束值必须是数字或"升级+数字"格式');
    if (expEnd <= expStart) throw new Error('经验结束值必须大于经验开始值');
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
  const dateNum = parseInt(now.toISOString().slice(8, 10));
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekday = weekdays[now.getDay()];
  
  return {
    date: dateNum, weekday: weekday, wechatName: sender, roleName: roleName,
    level: level, expStart: expStart, expEnd: expEnd.toString(), diff: diff,
    salary: salary, note: '', photoTime: '正常拍照'
  };
}

async function writeToNewSheet(gameData) {
  if (!SHEET_WEBHOOK_URL) throw new Error('未配置SHEET_WEBHOOK_URL');
  
  const payload = {
    add_records: [{
      values: {
        "fOlhsH": gameData.date,
        "fPRPMM": [{ "text": gameData.weekday }],
        "fPaTu6": gameData.wechatName,
        "fYjV7x": gameData.roleName,
        "fZ3sSb": gameData.level,
        "fayciJ": gameData.expStart,
        "fe513b": gameData.expEnd.toString(),
        "fj4ODK": gameData.diff,
        "fjpgjh": gameData.salary,
        "fssaCv": gameData.note || '',
        "fvdx3A": [{ "text": gameData.photoTime }]
      }
    }]
  };
  
  console.log('发送到新表格:', JSON.stringify(payload, null, 2));
  const response = await axios.post(SHEET_WEBHOOK_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });
  return response.data;
}

// 路由
app.get('/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  console.log('企业微信验证请求:', { msg_signature: msg_signature?.substring(0, 20) + '...', timestamp, nonce });
  
  if (!msg_signature || !timestamp || !nonce || !echostr) {
    return res.status(400).send('缺少必要参数');
  }
  
  try {
    const signature = getSignature(WECOM_TOKEN, timestamp, nonce, echostr);
    if (signature !== msg_signature) {
      console.error('签名验证失败', { expected: signature, actual: msg_signature });
      return res.status(403).send('签名验证失败');
    }
    console.log('✅ 签名验证成功');
    const decryptedMsg = decryptMsg(echostr, WECOM_ENCODING_AES_KEY);
    console.log('✅ 解密成功:', decryptedMsg);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(decryptedMsg);
  } catch (error) {
    console.error('验证失败:', error.message);
    res.status(500).send('验证失败: ' + error.message);
  }
});

app.post('/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    console.log('收到消息POST:', { msg_signature: msg_signature?.substring(0, 20) + '...', timestamp, nonce });
    
    let encryptedMsg = req.body.encrypt || req.body.Encrypt;
    if (!encryptedMsg) {
      console.log('未加密的请求体:', JSON.stringify(req.body, null, 2));
      return res.json({ code: -1, msg: '缺少encrypt字段' });
    }
    
    const signature = getSignature(WECOM_TOKEN, timestamp, nonce, encryptedMsg);
    if (signature !== msg_signature) {
      console.error('消息签名验证失败');
      return res.status(403).json({ code: -1, msg: '签名验证失败' });
    }
    
    const decryptedJsonStr = decryptMsg(encryptedMsg, WECOM_ENCODING_AES_KEY);
    console.log('解密后的消息字符串:', decryptedJsonStr);
    
    let message;
    try {
      message = JSON.parse(decryptedJsonStr);
      console.log('解析后的消息:', JSON.stringify(message, null, 2));
    } catch (jsonError) {
      console.error('JSON解析失败:', jsonError.message);
      return res.json({ code: -1, msg: 'JSON解析失败' });
    }
    
    let content = '', sender = '';
    if (message.text && message.text.content) {
      content = message.text.content;
      sender = message.from?.userid || '未知用户';
      console.log('原始消息:', { sender, content });
    } else {
      console.error('未知消息格式:', message);
      return res.json({ code: -1, msg: '未知消息格式' });
    }
    
    if (content) {
      try {
        const gameData = parseGameMessage(content, sender);
        console.log('解析的游戏数据:', gameData);
        const sheetResult = await writeToNewSheet(gameData);
        console.log('新表格写入结果:', sheetResult);
      } catch (parseError) {
        console.error('解析游戏数据失败:', parseError.message);
        await writeToNewSheet({
          roleName: '解析失败', level: 0, expStart: 0, expEnd: 0,
          wechatName: sender, originalMessage: content, error: parseError.message
        });
      }
    }
    
    res.json({ code: 0, msg: '消息已处理' });
  } catch (error) {
    console.error('处理消息失败:', error);
    res.json({ code: -1, msg: '处理失败', error: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: '游戏数据记录系统',
    status: '运行中',
    timestamp: new Date().toISOString(),
    config: { callback_url: '/callback', sheet_configured: !!SHEET_WEBHOOK_URL }
  });
});

app.post('/test', async (req, res) => {
  const { message = '@财务账号张三 等级50 经验开始1000 经验结束2000', sender = '测试用户', testType = 'normal' } = req.body;
  try {
    let testMessage = message;
    if (testType === 'upgrade') testMessage = '@财务账号张三 等级50 经验开始1000 经验结束升级+100';
    const gameData = parseGameMessage(testMessage, sender);
    const result = await writeToNewSheet(gameData);
    res.json({ success: true, message: '测试成功', data: { parsed: gameData, sheet_result: result } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()],
    date: new Date().getDate()
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 游戏数据记录系统启动，端口: ${PORT}`);
  console.log(`🔗 回调地址: /callback`);
  console.log(`📊 新表格Webhook: ${SHEET_WEBHOOK_URL ? '已配置' : '未配置'}`);
  console.log(`🎮 支持格式: @财务账号[角色] 等级[数字] 经验开始[数字] 经验结束[数字或升级+数字]`);
});
