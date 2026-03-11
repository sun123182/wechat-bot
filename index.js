const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json({ type: '*/*' })); // 接受任何Content-Type

// 配置
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL;
const WECOM_TOKEN = process.env.WECOM_TOKEN || 'IQCLf5VMl31IenTIoPk6953';
const WECOM_ENCODING_AES_KEY = process.env.WECOM_ENCODING_AES_KEY || 'x62C4zUbz8kGWunRHkN8m3t9nyDkzO8zELS3AtcWQ7f';

// ========== 企业微信回调验证（正确版） ==========

// 验证URL - 企业微信要求的完整验证
app.get('/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  
  console.log('企业微信验证请求:', { 
    msg_signature: msg_signature?.substring(0, 20) + '...',
    timestamp, 
    nonce,
    echostr: echostr?.substring(0, 50) + '...'
  });
  
  if (!msg_signature || !timestamp || !nonce || !echostr) {
    console.error('缺少必要参数');
    return res.status(400).send('缺少必要参数');
  }
  
  try {
    // 1. 验证签名
    const signature = getSignature(WECOM_TOKEN, timestamp, nonce, echostr);
    if (signature !== msg_signature) {
      console.error('签名验证失败', { 
        expected: signature, 
        actual: msg_signature 
      });
      return res.status(403).send('签名验证失败');
    }
    
    console.log('✅ 签名验证成功');
    
    // 2. 解密echostr
    const decryptedMsg = decryptMsg(echostr, WECOM_ENCODING_AES_KEY);
    console.log('✅ 解密成功:', decryptedMsg);
    
    // 3. 返回明文消息（不加引号、不带BOM、不带换行）
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(decryptedMsg);
    
  } catch (error) {
    console.error('验证失败:', error.message);
    res.status(500).send('验证失败: ' + error.message);
  }
});

// 接收消息
app.post('/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    
    console.log('收到消息POST:', {
      msg_signature: msg_signature?.substring(0, 20) + '...',
      timestamp, 
      nonce,
      body_type: typeof req.body,
      body_size: JSON.stringify(req.body).length
    });
    
    // 企业微信发送的是JSON，encrypt字段包含加密消息
    let encryptedMsg;
    
    if (req.body.encrypt) {
      encryptedMsg = req.body.encrypt;
    } else if (req.body.Encrypt) {
      encryptedMsg = req.body.Encrypt;
    } else {
      console.log('未加密的请求体:', JSON.stringify(req.body, null, 2));
      return res.json({ code: -1, msg: '缺少encrypt字段' });
    }
    
    // 验证签名
    const signature = getSignature(WECOM_TOKEN, timestamp, nonce, encryptedMsg);
    if (signature !== msg_signature) {
      console.error('消息签名验证失败');
      return res.status(403).json({ code: -1, msg: '签名验证失败' });
    }
    
    // 解密消息
    const decryptedXml = decryptMsg(encryptedMsg, WECOM_ENCODING_AES_KEY);
    console.log('解密后的XML:', decryptedXml);
    
    // 解析XML（简化版）
    const message = parseWeComXML(decryptedXml);
    console.log('解析后的消息:', message);
    
    // 写入表格
    if (message.MsgType === 'text' && message.Content) {
      const sheetResult = await writeToSheet(message.FromUserName, message.Content);
      console.log('表格写入结果:', sheetResult);
    }
    
    // 构造响应（企业微信要求加密响应）
    const responseXml = `<xml>
      <ToUserName><![CDATA[${message.FromUserName}]]></ToUserName>
      <FromUserName><![CDATA[${message.ToUserName}]]></FromUserName>
      <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
      <MsgType><![CDATA[text]]></MsgType>
      <Content><![CDATA[消息已记录到表格]]></Content>
    </xml>`;
    
    // 加密响应
    const encryptedResponse = encryptMsg(responseXml, WECOM_ENCODING_AES_KEY);
    const responseSignature = getSignature(WECOM_TOKEN, timestamp, nonce, encryptedResponse);
    
    const finalResponse = {
      encrypt: encryptedResponse,
      msgsignature: responseSignature,
      timestamp: parseInt(timestamp),
      nonce: nonce
    };
    
    res.json(finalResponse);
    
  } catch (error) {
    console.error('处理消息失败:', error);
    
    // 即使出错，也要返回企业微信期望的格式
    try {
      const errorResponse = encryptMsg('<xml><MsgType>text</MsgType><Content>处理失败</Content></xml>', WECOM_ENCODING_AES_KEY);
      const responseSignature = getSignature(WECOM_TOKEN, req.query.timestamp, req.query.nonce, errorResponse);
      
      res.json({
        encrypt: errorResponse,
        msgsignature: responseSignature,
        timestamp: parseInt(req.query.timestamp || Date.now() / 1000),
        nonce: req.query.nonce || 'error'
      });
    } catch (encryptError) {
      res.status(500).json({ code: -1, msg: '处理失败', error: error.message });
    }
  }
});

// ========== 工具函数 ==========

// 生成签名
function getSignature(token, timestamp, nonce, encryptedMsg) {
  const str = [token, timestamp, nonce, encryptedMsg].sort().join('');
  return crypto.createHash('sha1').update(str).digest('hex');
}

// 解密消息（企业微信标准算法）
function decryptMsg(encrypted, encodingAESKey) {
  if (!encodingAESKey || encodingAESKey.length !== 43) {
    throw new Error('EncodingAESKey必须是43位');
  }
  
  // 添加'='补全到44位base64
  const key = Buffer.from(encodingAESKey + '=', 'base64');
  
  if (key.length !== 32) {
    throw new Error('解码后的Key长度必须是32字节');
  }
  
  const iv = key.slice(0, 16);
  const encryptedBuffer = Buffer.from(encrypted, 'base64');
  
  // 创建解密器
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false); // 企业微信使用自定义padding
  
  let decrypted = decipher.update(encryptedBuffer);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  // 移除头部16字节随机字符串
  decrypted = decrypted.slice(16);
  
  // 获取消息长度（4字节网络字节序）
  const msgLength = decrypted.readUInt32BE(0);
  
  // 提取消息内容
  const msg = decrypted.slice(4, 4 + msgLength).toString('utf8');
  
  // 后面是企业ID，智能机器人场景为空
  return msg;
}

// 加密消息
function encryptMsg(msg, encodingAESKey) {
  if (!encodingAESKey || encodingAESKey.length !== 43) {
    throw new Error('EncodingAESKey必须是43位');
  }
  
  const key = Buffer.from(encodingAESKey + '=', 'base64');
  const iv = key.slice(0, 16);
  
  // 生成16字节随机字符串
  const randomBytes = crypto.randomBytes(16);
  
  // 消息长度（4字节）
  const msgBuffer = Buffer.from(msg, 'utf8');
  const msgLength = Buffer.alloc(4);
  msgLength.writeUInt32BE(msgBuffer.length, 0);
  
  // 企业ID（智能机器人场景为空）
  const corpId = Buffer.from('', 'utf8');
  
  // 拼接：随机字符串 + 消息长度 + 消息 + 企业ID
  const toEncrypt = Buffer.concat([randomBytes, msgLength, msgBuffer, corpId]);
  
  // 创建加密器
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  
  let encrypted = cipher.update(toEncrypt);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return encrypted.toString('base64');
}

// 解析XML消息（简化版）
function parseWeComXML(xml) {
  const fromMatch = xml.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);
  const toMatch = xml.match(/<ToUserName><!\[CDATA\[(.*?)\]\]><\/ToUserName>/);
  const contentMatch = xml.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
  const msgTypeMatch = xml.match(/<MsgType><!\[CDATA\[(.*?)\]\]><\/MsgType>/);
  
  return {
    FromUserName: fromMatch ? fromMatch[1] : '',
    ToUserName: toMatch ? toMatch[1] : '',
    Content: contentMatch ? contentMatch[1] : '',
    MsgType: msgTypeMatch ? msgTypeMatch[1] : ''
  };
}

// ========== 其他接口 ==========

// 首页
app.get('/', (req, res) => {
  res.json({
    service: '企业微信智能机器人回调服务',
    status: '运行中',
    timestamp: new Date().toISOString(),
    config: {
      callback_url: '/callback',
      token_configured: !!WECOM_TOKEN,
      aeskey_configured: !!WECOM_ENCODING_AES_KEY && WECOM_ENCODING_AES_KEY.length === 43,
      sheet_configured: !!SHEET_WEBHOOK_URL
    }
  });
});

// 测试表格写入
app.post('/test', async (req, res) => {
  const { sender = '测试用户', message = '测试消息' } = req.body;
  
  try {
    const result = await writeToSheet(sender, message);
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
    config: {
      token_length: WECOM_TOKEN?.length || 0,
      aeskey_length: WECOM_ENCODING_AES_KEY?.length || 0,
      port: process.env.PORT || 10000
    }
  });
});

// 写入表格
async function writeToSheet(sender, message) {
  if (!SHEET_WEBHOOK_URL) {
    throw new Error('未配置SHEET_WEBHOOK_URL');
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
  
  const response = await axios.post(SHEET_WEBHOOK_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });
  
  return response.data;
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 企业微信智能机器人服务启动，端口: ${PORT}`);
  console.log(`🔗 回调地址: /callback`);
  console.log(`🔑 Token: ${WECOM_TOKEN} (${WECOM_TOKEN?.length || 0}位)`);
  console.log(`🔐 AESKey: ${WECOM_ENCODING_AES_KEY ? '已配置(' + WECOM_ENCODING_AES_KEY.length + '位)' : '未配置'}`);
  console.log(`📊 表格Webhook: ${SHEET_WEBHOOK_URL ? '已配置' : '未配置'}`);
});
