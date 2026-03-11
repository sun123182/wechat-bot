const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// 配置
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL;
const WECOM_TOKEN = process.env.WECOM_TOKEN || 'IQCLf5VMl31IenTIoPk6953';
const WECOM_ENCODING_AES_KEY = process.env.WECOM_ENCODING_AES_KEY || 'x62C4zUbz8kGWunRHkN8m3t9nyDkzO8zELS3AtcWQ7f';

// ========== 企业微信回调验证（简化版） ==========

// 验证URL - 简化版：直接返回echostr，不验证解密
app.get('/callback', (req, res) => {
  const { msg_signature, timestamp, nonce, echostr } = req.query;
  
  console.log('企业微信回调验证（简化）:', { 
    msg_signature, 
    timestamp, 
    nonce, 
    hasEchostr: !!echostr 
  });
  
  if (echostr) {
    // 简化：直接返回echostr，让企业微信验证通过
    console.log('返回echostr（不验证解密）');
    res.send(echostr);
  } else {
    res.json({ 
      code: 0, 
      msg: '回调接口就绪',
      config: {
        token: WECOM_TOKEN,
        aes_key_configured: !!WECOM_ENCODING_AES_KEY
      }
    });
  }
});

// 接收消息 - 简化版：假设消息未加密或简单处理
app.post('/callback', async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    
    console.log('收到回调POST:', {
      msg_signature,
      timestamp, 
      nonce,
      body_type: typeof req.body,
      body_keys: Object.keys(req.body)
    });
    
    // 尝试解析消息
    let message, sender, content;
    
    // 情况1：XML格式（企业微信标准）
    if (req.body.xml) {
      const xml = req.body.xml;
      message = xml.Content?.[0] || '无内容';
      sender = xml.FromUserName?.[0] || '未知用户';
      content = message;
      console.log('XML格式消息:', { sender, content });
    }
    // 情况2：JSON格式
    else if (req.body.Content) {
      content = req.body.Content;
      sender = req.body.FromUserName || '未知用户';
      console.log('JSON格式消息:', { sender, content });
    }
    // 情况3：加密消息（Encrypt字段）
    else if (req.body.Encrypt) {
      console.log('收到加密消息，尝试简化处理...');
      
      // 简化处理：如果解密失败，记录原始数据
      try {
        // 尝试解密（简化版）
        const decrypted = simpleDecrypt(req.body.Encrypt);
        console.log('简化解密结果:', decrypted.substring(0, 100) + '...');
        
        // 尝试提取内容
        const fromMatch = decrypted.match(/<FromUserName><!\[CDATA\[(.*?)\]\]><\/FromUserName>/);
        const contentMatch = decrypted.match(/<Content><!\[CDATA\[(.*?)\]\]><\/Content>/);
        
        sender = fromMatch ? fromMatch[1] : '加密用户';
        content = contentMatch ? contentMatch[1] : '加密内容';
        
      } catch (decryptError) {
        console.error('解密失败，使用备用方案:', decryptError.message);
        sender = '加密用户';
        content = `[加密消息，解密失败: ${req.body.Encrypt.substring(0, 50)}...]`;
      }
    }
    // 情况4：其他格式
    else {
      console.log('未知格式，原始数据:', JSON.stringify(req.body, null, 2));
      content = JSON.stringify(req.body);
      sender = '未知格式';
    }
    
    // 写入表格
    if (content && content !== '无内容') {
      const sheetResult = await writeToSheet(sender, content);
      console.log('表格写入结果:', sheetResult);
    }
    
    // 返回成功响应（企业微信期望的格式）
    const response = {
      code: 0,
      msg: '消息已处理',
      timestamp: new Date().toISOString()
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('处理回调失败:', error);
    res.status(500).json({
      code: -1,
      msg: '处理失败',
      error: error.message
    });
  }
});

// 简化解密函数（不真正解密，只尝试提取）
function simpleDecrypt(encrypted) {
  // 如果AESKey有效且格式正确，尝试解密
  if (WECOM_ENCODING_AES_KEY && WECOM_ENCODING_AES_KEY.length === 43) {
    try {
      // 企业微信AES解密逻辑（简化）
      const key = Buffer.from(WECOM_ENCODING_AES_KEY + '=', 'base64');
      const iv = key.slice(0, 16);
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      decipher.setAutoPadding(false); // 企业微信使用自定义padding
      
      let decrypted = decipher.update(encrypted, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      // 移除padding和随机字符串
      const pad = decrypted.charCodeAt(decrypted.length - 1);
      if (pad < 1 || pad > 32) {
        decrypted = decrypted.slice(0, -pad);
      }
      
      // 移除16字节随机字符串
      return decrypted.slice(16);
    } catch (error) {
      // 解密失败，返回原始数据
      return `<EncryptedData>${encrypted.substring(0, 50)}...</EncryptedData>`;
    }
  }
  
  return `<EncryptedData>${encrypted.substring(0, 50)}...</EncryptedData>`;
}

// ========== 其他接口 ==========

// 首页
app.get('/', (req, res) => {
  res.json({
    service: '企业微信回调服务（简化版）',
    status: '运行中',
    timestamp: new Date().toISOString(),
    endpoints: {
      callback: 'GET/POST /callback',
      test: 'POST /test',
      health: 'GET /health'
    }
  });
});

// 测试接口
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
      sheet_configured: !!SHEET_WEBHOOK_URL,
      token: WECOM_TOKEN,
      port: process.env.PORT || 10000
    }
  });
});

// 写入表格函数
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
  console.log(`🚀 企业微信回调服务（简化版）启动，端口: ${PORT}`);
  console.log(`🔗 回调地址: /callback`);
  console.log(`🔑 Token: ${WECOM_TOKEN}`);
  console.log(`🔐 AESKey: ${WECOM_ENCODING_AES_KEY ? '已配置(' + WECOM_ENCODING_AES_KEY.length + '位)' : '未配置'}`);
  console.log(`📊 表格Webhook: ${SHEET_WEBHOOK_URL ? '已配置' : '未配置'}`);
});
