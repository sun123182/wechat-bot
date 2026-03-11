const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { parseString } = require('xml2js');

const app = express();
app.use(express.json());

// 配置（从环境变量读取）
const SHET_WEBHOK_URL = process.env.SHET_WEBHOK_URL;
const WECOM_TOKEN = process.env.WECOM_TOKEN || 'IQCLf5VMl31IenTIoPk6953';
const WECOM_ENCODING_AES_KEY = process.env.WECOM_ENCODING_AES_KEY || 'x62C4zUbz8kGWunRHkN8m3t9nyDkzO8zELS3AtcWQ7f';

// ======== 企业微信回调验证 ========

// 验证URL（企业微信首次配置回调时调用）
app.get('/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  
  console.log('企业微信回调验证:', { msg_signature, timestamp, nonce, echostr: echostr?.substring(0, 50) + '...' });
  
  if (!msg_signature || !timestamp || !nonce || !echostr) {
    return res.status(400).send('缺少必要参数');
  }
  
  // 验证签名
  const signature = getSignature(WECOM_TOKEN, timestamp, nonce, echostr);
  
  if (signature === msg_signature) {
    // 签名验证成功
    console.log('签名验证成功');
    
    // 如果有EncodingAESKey，需要解密
    if (WECOM_ENCODING_AES_KEY) {
      try {
        const decrypted = decryptAES(echostr, WECOM_ENCODING_AES_KEY);
        console.log('解密成功，返回:', decrypted);
        res.send(decrypted);
      } catch (error) {
        console.error('解密失败:', error);
        res.status(500).send('解密失败');
      }
    } else {
      // 没有加密，直接返回
      res.send(echostr);
    }
  } else {
    console.error('签名验证失败', { expected: signature, actual: msg_signature });
    res.status(403).send('签名验证失败');
  }
});

// 接收企业微信消息
app.post('/callback', async (req, res) => {
  const { msg_signature, timestamp, nonce } = req.query;
  
  // 企业微信可能发送XML或JSON格式
  let encryptedMsg;
  
  if (req.body.Encrypt) {
    encryptedMsg = req.body.Encrypt;
  } else if (req.body.encrypt) {
    encryptedMsg = req.body.encrypt;
  } else if (req.body.xml && req.body.xml.Encrypt) {
    encryptedMsg = req.body.xml.Encrypt[0];
  } else {
    console.log('未加密的请求体:', JSON.stringify(req.body, null, 2));
    // 可能是测试消息或未加密格式
    return handlePlainMessage(req.body, res);
  }
  
  console.log('收到加密消息:', { 
    msg_signature, 
    timestamp, 
    nonce, 
    encryptedMsg: encryptedMsg?.substring(0, 50) + '...' 
  });
  
  // 验证签名
  const signature = getSignature(WECOM_TOKEN, timestamp, nonce, encryptedMsg);
  if (signature !== msg_signature) {
    console.error('签名验证失败', { expected: signature, actual: msg_signature });
    return res.status(403).json({ code: -1, msg: '签名验证失败' });
  }
  
  try {
    // 解密消息
    let decryptedXml;
    if (WECOM_ENCODING_AES_KEY) {
      decryptedXml = decryptAES(encryptedMsg, WECOM_ENCODING_AES_KEY);
    } else {
      decryptedXml = encryptedMsg; // 未加密
    }
    
    console.log('解密后的XML:', decryptedXml);
    
    // 解析XML消息
    const message = await parseWeComXML(decryptedXml);
    console.log('解析后的消息:', message);
    
    // 只处理文本消息
    if (message.MsgType === 'text') {
      // 写入智能表格
      const sheetResult = await writeToWeComSheet(message.FromUserName, message.Content);
      console.log('表格写入结果:', sheetResult);
    }
    
    // 返回成功响应（企业微信要求返回加密的XML）
    const responseXml = `<xml>
      <ToUserName><![CDATA[${message.FromUserName}]]></ToUserName>
      <FromUserName><![CDATA[${message.ToUserName}]]></FromUserName>
      <CreateTime>${Math.floor(Date.now() / 100)}</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[消息已记录到表格]]></Content>
    </xml>`;
    
    let finalResponse;
    if (WECOM_ENCODING_AESKey) {
      const encryptedResponse = encryptAES(responseXml, WECOM_ENCODING_AES_KEY);
      const responseSignature = getSignature(WECOM_TOKEN, timestamp, nonce, encryptedResponse);
      
      finalResponse = {
        Encrypt: encryptedResponse,
        MsgSignature: responseSignature,
        TimeStamp: timestamp,
        Nonce: nonce
      };
    } else {
      finalResponse = responseXml;
    }
    
    res.json(finalResponse);
    
  } catch (error) {
    console.error('处理消息失败:', error);
    res.status(500).json({ code: -1, msg: '处理失败', error: error.message });
  }
});

// 处理未加密的消息（测试用）
async function handlePlainMessage(body, res) {
  try {
    console.log('处理未加密消息:', body);
    
    // 尝试提取消息内容
    let content = '未知消息';
    let sender = '未知用户';
    
    if (body.Content) {
      content = body.Content;
    } else if (body.content) {
      content = body.content;
    }
    
    if (body.FromUserName) {
      sender = body.FromUserName;
    } else if (body.sender) {
      sender = body.sender;
    }
    
    // 写入表格
    const sheetResult = await writeToWeComSheet(sender, content);
    
    res.json({
      code: 0,
      msg: '消息已接收',
      data: sheetResult
    });
    
  } catch (error) {
    console.error('处理未加密消息失败:', error);
    res.status(500).json({ code: -1, msg: '处理失败', error: error.message });
  }
}

// ======== 其他接口 ========

// 首页
app.get('/', (req, res) => {
  res.json({
    service: '企业微信自建应用回调服务',
    status: '运行中',
    timestamp: new Date().toISOString(),
    config: {
      callback_url: '/callback',
      token_configured: !!WECOM_TOKEN,
      aeskey_configured: !!WECOM_ENCODING_AES_KEY,
      sheet_configured: !!SHET_WEBHOK_URL
    }
  });
});

// 测试表格写入
app.post('/test', async (req, res) => {
  const { sender = '测试用户', message = '测试消息' } = req.body;
  
  try {
    const result = await writeToWeComSheet(sender, message);
    res.json({
      success: true,
      message: '测试写入成功',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 100
  });
});

// ======== 工具函数 ========

// 生成签名
function getSignature(token, timestamp, nonce, encryptedMsg) {
  const str = [token, timestamp, nonce, encryptedMsg].sort().join('');
  return crypto.createHash('sha1').update(str).digest('hex');
}

// AES解密（简化版）
function decryptAES(encrypted, encodingAESKey) {
  try {
    const key = Buffer.from(encodingAESKey + '=', 'base64');
    const iv = key.slice(0, 16);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    // 企业微信的格式：随机16字节 + 4字节消息长度 + 消息内容 + 企业ID
    const content = decrypted.slice(16); // 移除随机字符串
    const xmlLength = parseInt(content.slice(0, 4), 10);
    const xmlContent = content.slice(4, 4 + xmlLength);
    
    return xmlContent;
  } catch (error) {
    console.error('解密错误:', error);
    throw new Error('解密失败: ' + error.message);
  }
}

// AES加密
function encryptAES(text, encodingAESKey) {
  const key = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = key.slice(0, 16);
  
  // 生成16字节随机字符串
  const randomStr = crypto.randomBytes(16).toString('hex').slice(0, 16);
  const xmlLength = Buffer.byteLength(text).toString().padStart(4, '0');
  
  // 企业微信格式
  const content = randomStr + xmlLength + text + 'your-corp-id';
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(content, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  return encrypted;
}

// 解析XML消息
function parseWeComXML(xml) {
  return new Promise((resolve, reject) => {
    parseString(xml, { explicitArray: false }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      
      const xmlObj = result.xml || result;
      resolve({
        ToUserName: xmlObj.ToUserName || '',
        FromUserName: xmlObj.FromUserName || '',
        CreateTime: xmlObj.CreateTime || '',
        MsgType: xmlObj.MsgType || '',
        Content: xmlObj.Content || '',
        MsgId: xmlObj.MsgId || ''
      });
    });
  });
}

// 写入表格（不包含人员列）
async function writeToWeComSheet(sender, message) {
  if (!SHET_WEBHOK_URL) {
    throw new Error('未配置SHET_WEBHOK_URL');
  }
  
  const timestamp = Date.now().toString();
  
  const payload = {
    add_records: [
      {
        values: {
          "f04Gwj": message,
          "ftQMc5": [{ "text": "企业微信消息" }],
          "ffFwIh": message.length,
          "fn8TJd": timestamp
        }
      }
    ]
  };
  
  console.log('发送到表格:', JSON.stringify(payload, null, 2));
  
  const response = await axios.post(SHET_WEBHOK_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 100
  });
  
  return response.data;
}

const PORT = process.env.PORT || 100;
app.listen(PORT, () => {
  console.log(`🚀 企业微信回调服务启动，端口: ${PORT}`);
  console.log(`🔗 回调地址: /callback`);
  console.log(`🔑 Token: ${WECOM_TOKEN}`);
  console.log(`🔐 AESKey: ${WECOM_ENCODING_AES_KEY ? '已配置' : '未配置'}`);
  console.log(`📊 表格Webhook: ${SHET_WEBHOK_URL ? '已配置' : '未配置'}`);
});
