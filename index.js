const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json({ type: '*/*' }));

const SHEET_WEBHOOK_URL = 'https://qyapi.weixin.qq.com/cgi-bin/wedoc/smartsheet/webhook?key=6iF6Lo6a7HEgpriBc2vmbRc7MihUPMPU1p8mneZwGoG9CCOZTA03aRpFbTfBiFhwRkN0KX0hJxgr3U2PMGwghTWFxUSXX1I4VlvMWq3zdHjX';
const WECOM_TOKEN = process.env.WECOM_TOKEN || 'IQCLf5VMl31IenTIoPk6953';
const WECOM_ENCODING_AES_KEY = process.env.WECOM_ENCODING_AES_KEY || 'x62C4zUbz8kGWunRHkN8m3t9nyDkzO8zELS3AtcWQ7f';

const EXPERIENCE_TABLE = {
  1:15,2:34,3:57,4:92,5:135,6:372,7:560,8:840,9:1242,10:1716,11:2360,12:3216,13:4200,14:5460,15:7050,
  16:8840,17:11040,18:13716,19:16680,20:20216,21:24402,22:28980,23:34320,24:40512,25:47216,26:54900,
  27:63666,28:73080,29:83720,30:95700,31:108480,32:122760,33:138666,34:155540,35:174216,36:194832,
  37:216600,38:240500,39:266682,40:294216,41:324240,42:356916,43:391160,44:428280,45:468450,46:510420,
  47:555680,48:604416,49:655200,50:709716,51:748608,52:789631,53:832902,54:878545,55:926689,56:977471,
  57:1031036,58:1087536,59:1147132,60:1209994,61:1276301,62:1346242,63:1420016,64:1497832,65:1579913,
  66:1666492,67:1757815,68:1854143,69:1955750,70:2062925,71:2175973,72:2295216,73:2420993,74:2553663,
  75:2693603,76:2841212,77:2996910,78:3161140,79:3334370,80:3517093,81:3709829,82:3913127,83:4127566,
  84:4353756,85:4592341,86:4844001,87:5109452,88:5389449,89:5684790,90:5996316,91:6324914,92:6671519,
  93:7037118,94:7422752,95:7829518,96:8258575,97:8711144,98:9188514,99:9692044,100:10223168,101:10783397,
  102:11374327,103:11997640,104:12655110,105:13348610,106:14080113,107:14851703,108:15665576,109:16524049,
  110:17429566,111:18384706,112:19392187,113:20454878,114:21575805,115:22758159,116:24005306,117:25320796,
  118:26708375,119:28171993,120:29715818,121:31344244,122:33061908,123:34873700,124:36784778,125:38800583,
  126:40926854,127:43169645,128:45535341,129:48030677,130:50662758,131:53439077,132:56367538,133:59456479,
  134:62714694,135:66151459,136:69776558,137:73600313,138:77633610,139:81887931,140:86375389,141:91108760,
  142:96101520,143:101367883,144:106922842,145:112782213,146:118962678,147:125481832,148:132358236,
  149:139611467,150:147262175,151:155332142,152:163844343,153:172823012,154:182293713,155:192283408,
  156:202820538,157:213935103,158:225658746,159:238024845,160:251068606,161:264827165,162:279339693,
  163:294647508,164:310794191,165:327825712,166:345790561,167:364739883,168:384727628,169:405810702,
  170:428049128,171:451506220,172:476248760,173:502347192,174:529875818,175:558913012,176:589541445,
  177:621848316,178:655925603,179:691870326,180:729784819,181:769777027,182:811960808,183:856456260,
  184:903390063,185:952895838,186:1005114529,187:1060194805,188:1118293480,189:1179575962,190:1244216724,
  191:1312399800,192:1384319309,193:1460180007,194:1540197871,195:1624600714,196:1713628833,197:1807535693,
  198:1906588648,199:2011069705,200:2121276324
};

function getSignature(token, timestamp, nonce, encryptedMsg) {
  const str = [token, timestamp, nonce, encryptedMsg].sort().join('');
  return crypto.createHash('sha1').update(str).digest('hex');
}

function decryptMsg(encrypted, encodingAESKey) {
  console.log('开始解密，EncodingAESKey长度:', encodingAESKey?.length);
  
  if (!encodingAESKey || encodingAESKey.length !== 43) {
    throw new Error(`EncodingAESKey必须是43位，实际长度: ${encodingAESKey?.length}`);
  }
  
  try {
    const key = Buffer.from(encodingAESKey + '=', 'base64');
    console.log('解码后Key长度:', key.length, '期望: 32');
    
    if (key.length !== 32) {
      throw new Error(`解码后的Key长度必须是32字节，实际: ${key.length}`);
    }
    
    const iv = key.slice(0, 16);
    const encryptedBuffer = Buffer.from(encrypted, 'base64');
    console.log('加密Buffer长度:', encryptedBuffer.length);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);
    
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    console.log('解密后Buffer长度:', decrypted.length);
    
    if (decrypted.length < 20) {
      throw new Error('解密后数据太短');
    }
    
    const msgLength = decrypted.readUInt32BE(16);
    console.log('消息长度:', msgLength);
    
    if (msgLength < 0 || msgLength > decrypted.length - 20) {
      throw new Error(`消息长度无效: ${msgLength}`);
    }
    
    const content = decrypted.slice(20, 20 + msgLength);
    const msgContent = content.toString('utf8');
    
    console.log('提取的消息内容:', msgContent);
    
    return msgContent;
    
  } catch (error) {
    console.error('解密过程错误:', error.message);
    throw error;
  }
}

function getUpgradeExperience(level) {
  return EXPERIENCE_TABLE[level] || null;
}

function parseGameMessage(message, sender) {
  let cleanMessage = message.replace(/@财务账号/g, '').replace(/@财务/g, '').trim();
  console.log('清理后消息:', cleanMessage);
  
  const accountMatch = cleanMessage.match(/账号\s*(\S+)/);
  const levelMatch = cleanMessage.match(/等级\s*(\d+)/);
  
  console.log('账号匹配:', accountMatch);
  console.log('等级匹配:', levelMatch);
  
  const startPatterns = [/开始\s*(\d+)/, /经验开始\s*(\d+)/, /开始经验\s*(\d+)/];
  const endPatterns = [/结束\s*(\d+)/, /经验结束\s*(\d+)/, /结束经验\s*(\d+)/];
  
  let expStartMatch = null;
  let expEndMatch = null;
  
  for (const pattern of startPatterns) {
    const match = cleanMessage.match(pattern);
    if (match) {
      expStartMatch = match;
      console.log('开始经验匹配:', pattern, '->', match);
      break;
    }
  }
  
  for (const pattern of endPatterns) {
    const match = cleanMessage.match(pattern);
    if (match) {
      expEndMatch = match;
      console.log('结束经验匹配:', pattern, '->', match);
      break;
    }
  }
  
  if (!expEndMatch) {
    const upgradePatterns = [/结束\s*(升级\+?\d+)/, /经验结束\s*(升级\+?\d+)/, /结束经验\s*(升级\+?\d+)/];
    for (const pattern of upgradePatterns) {
      const match = cleanMessage.match(pattern);
      if (match) {
        expEndMatch = match;
        console.log('升级格式匹配:', pattern, '->', match);
        break;
      }
    }
  }
  
  if (!accountMatch || !levelMatch || !expStartMatch || !expEndMatch) {
    console.log('匹配失败详情:', {
      account: !!accountMatch,
      level: !!levelMatch,
      start: !!expStartMatch,
      end: !!expEndMatch
    });
    throw new Error('消息格式不正确，需要包含：账号[角色名] 等级[数字] 开始经验[数字] 结束经验[数字或升级+数字]');
  }
  
  const roleName = accountMatch[1];
  const level = parseInt(levelMatch[1], 10);
  const expStart = parseInt(expStartMatch[1], 10);
  const expEndStr = expEndMatch[1];
  
  console.log('解析结果:', { roleName, level, expStart, expEndStr });
  
  let expEnd, diff;
  const upgradeMatch = expEndStr.match(/升级\+?(\d+)/);
  
  if (upgradeMatch) {
    const extraExp = parseInt(upgradeMatch[1], 10);
    const upgradeExpNeeded = getUpgradeExperience(level);
    if (upgradeExpNeeded === null) throw new Error(`找不到等级${level}的升级所需经验数据`);
    diff = Math.round((upgradeExpNeeded / 10000) - expStart + extraExp);
    expEnd = `升级+${extraExp}`;
    console.log(`升级计算: 等级${level}升级需${upgradeExpNeeded}, 开始${expStart}, 结束${extraExp}, 差值=${diff}`);
  } else {
    expEnd = parseInt(expEndStr, 10);
    console.log('尝试解析结束经验为数字:', expEndStr, '->', expEnd);
    
    if (isNaN(expEnd)) {
      throw new Error('经验结束值必须是数字或"升级+数字"格式，实际值: ' + expEndStr);
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
        "fe513b": gameData.expEnd.includes('升级') ? 0 : gameData.expEnd,
        "fj4ODK": gameData.diff,
        "fjpgjh": gameData.salary,
        "fssaCv": gameData.note || '',
        "fvdx3A": [{ "text": gameData.photoTime }]
      }
    }]
  };
  
  console.log('发送到新表格:', JSON.stringify(payload, null, 2));
  
  try {
    const response = await axios.post(SHEET_WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    console.log('表格写入成功:', response.data);
    return response.data;
  } catch (error) {
    console.error('表格写入失败:', error.response?.data || error.message);
    throw error;
  }
}

app.get('/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  console.log('企业微信验证请求:', { 
    msg_signature: msg_signature?.substring(0, 10) + '...', 
    timestamp, 
    nonce,
    echostr: echostr?.substring(0, 20) + '...'
  });
  
  if (!msg_signature || !timestamp || !nonce || !echostr) {
    return res.status(400).send('缺少必要参数');
  }
  
  try {
    const signature = getSignature(WECOM_TOKEN, timestamp, nonce, echostr);
    console.log('计算签名:', signature.substring(0, 10) + '...');
    
    if (signature !== msg_signature) {
      console.error('签名验证失败');
      console.error('期望:', signature);
      console.error('实际:', msg_signature);
      return res.status(403).send('签名验证失败');
    }
    
    console.log('✅ 签名验证成功');
    
    const decryptedMsg = decryptMsg(echostr, WECOM_ENCODING_AES_KEY);
    console.log('✅ 解密成功，返回明文:', decryptedMsg);
    
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
      return res.json({ code: -1,
                             msg: '未知消息格式' });
    }
    if (content) {
      try {
        const gameData = parseGameMessage(content, sender);
        console.log('解析的游戏数据:', gameData);
        const sheetResult = await writeToNewSheet(gameData);
        console.log('新表格写入结果:', sheetResult);
      } catch (parseError) {
        console.error('解析游戏数据失败:', parseError.message);
        const errorPayload = {
          add_records: [{
            values: {
              "fPaTu6": sender,
              "fYjV7x": "解析失败",
              "fssaCv": parseError.message
            }
          }]
        };
        try {
          await axios.post(SHEET_WEBHOOK_URL, errorPayload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
          });
        } catch (sheetError) {
          console.error('错误信息写入表格失败:', sheetError.message);
        }
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
  const { message = '@财务账号张三 等级50 开始1000 结束2000', sender = '测试用户', testType = 'normal' } = req.body;
  try {
    let testMessage = message;
    if (testType === 'upgrade') testMessage = '@财务账号mao 等级180 开始10000 结束升级10000';
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
  console.log(`🎮 支持格式: @财务账号[角色] 等级[数字] 开始经验[数字] 结束经验[数字或升级+数字]`);
  console.log(`📈 经验表: 1-200级完整数据`);
  console.log(`🧮 差值计算: 升级情况 = (升级所需经验 ÷ 10000) - 开始经验 + 结束经验`);
  console.log(`🔄 升级格式处理: 表格字段fe513b发送数字0`);
});
