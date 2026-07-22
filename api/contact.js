// SealQ B2B Inquiry Handler - Vercel Serverless Function
// Sends inquiry via Gmail SMTP (App Password) using Node built-in net/tls (zero deps)
// STARTTLS over port 587 per FreshLock Vercel experience (基础设定/experience/node_native_smtp.md)
const net = require('net');
const tls = require('tls');
const { Buffer } = require('buffer');

const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_USER = 'jasonyuan866@gmail.com';
const SMTP_PASS = 'fintawjilffveoeo';
const TO_EMAIL = 'jasonyuan866@gmail.com';
const FROM_EMAIL = 'jasonyuan866@gmail.com';

function b64(s){return Buffer.from(s).toString('base64')}
function eb64(s){return b64(unescape(encodeURIComponent(s)))}

function cmd(socket, line){return new Promise((res,rej)=>{socket.write(line+'\r\n');res()})}

function expect(socket, pattern, timeoutMs=15000){
  return new Promise((resolve,reject)=>{
    let buf='';
    const to=setTimeout(()=>{cleanup();reject(new Error('SMTP timeout waiting for '+pattern))},timeoutMs);
    function onData(d){
      buf+=d.toString('utf8');
      const lines=buf.split('\r\n').filter(l=>l);
      for(const l of lines){
        if(/^\d{3}\s/.test(l)){
          const code=l.substring(0,3);
          if(pattern.test(l)){cleanup();resolve({code,line:l,buf});return}
          if(!/^[23]/.test(code)){cleanup();reject(new Error('SMTP '+code+': '+l));return}
        }
      }
    }
    function onErr(e){cleanup();reject(e)}
    function onEnd(){cleanup();reject(new Error('SMTP connection closed'))}
    function cleanup(){clearTimeout(to);socket.removeListener('data',onData);socket.removeListener('error',onErr);socket.removeListener('end',onEnd)}
    socket.on('data',onData);socket.on('error',onErr);socket.on('end',onEnd);
  });
}

async function sendMail({from,to,subject,textBody,htmlBody,replyTo}){
  return new Promise(async (resolve,reject)=>{
    let socket=net.createConnection({host:SMTP_HOST,port:SMTP_PORT},async()=>{
      try{
        await expect(socket,/^220/);
        await cmd(socket,'EHLO sealq-b2b.vercel.app');
        await expect(socket,/^250/);
        await cmd(socket,'STARTTLS');
        await expect(socket,/^220/);
        const tlsOpts={host:SMTP_HOST,servername:SMTP_HOST,socket,rejectUnauthorized:true};
        const tlsSock=tls.connect(tlsOpts,async()=>{
          try{
            // re-EHLO after TLS
            await new Promise(r=>setTimeout(r,200));
            await cmd(tlsSock,'EHLO sealq-b2b.vercel.app');
            await expect(tlsSock,/^250/);
            await cmd(tlsSock,'AUTH PLAIN');
            await expect(tlsSock,/^235|^334/);
            await cmd(tlsSock,b64('\0'+SMTP_USER+'\0'+SMTP_PASS));
            await expect(tlsSock,/^235/);
            await cmd(tlsSock,`MAIL FROM:<${from||FROM_EMAIL}>`);
            await expect(tlsSock,/^250/);
            await cmd(tlsSock,`RCPT TO:<${to||TO_EMAIL}>`);
            await expect(tlsSock,/^250/);
            await cmd(tlsSock,'DATA');
            await expect(tlsSock,/^354/);
            const headers=[
              `From: "SealQ Website" <${from||FROM_EMAIL}>`,
              `To: <${to||TO_EMAIL}>`,
              replyTo?`Reply-To: ${replyTo}`:'',
              `Subject: =?UTF-8?B?${eb64(subject)}?=`,
              'MIME-Version: 1.0',
              'Content-Type: multipart/alternative; boundary=sealq-boundary',
              '',
              '--sealq-boundary',
              'Content-Type: text/plain; charset=UTF-8',
              'Content-Transfer-Encoding: base64',
              '',
              b64(unescape(encodeURIComponent(textBody))),
              '',
              '--sealq-boundary',
              'Content-Type: text/html; charset=UTF-8',
              'Content-Transfer-Encoding: base64',
              '',
              b64(unescape(encodeURIComponent(htmlBody))),
              '',
              '--sealq-boundary--',
              '.',
            ].filter(Boolean).join('\r\n');
            await cmd(tlsSock,headers);
            await expect(tlsSock,/^250/);
            await cmd(tlsSock,'QUIT');
            tlsSock.end();
            resolve({ok:true});
          }catch(e){reject(e);try{tlsSock.end()}catch(_){}}
        });
        tlsSock.on('error',e=>reject(e));
      }catch(e){reject(e);try{socket.end()}catch(_){}}
    });
    socket.on('error',e=>reject(e));
    socket.setTimeout(20000,()=>{try{socket.destroy()}catch(_){};reject(new Error('SMTP connection timeout'))});
  });
}

module.exports = async function handler(req,res){
  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'Method not allowed'});
  try{
    const body=req.body&&typeof req.body==='object'?req.body:{};
    const name=(body.name||'').toString().trim().slice(0,100);
    const email=(body.email||'').toString().trim().slice(0,120);
    const product=(body.product||'').toString().slice(0,200);
    const quantity=(body.quantity||'').toString().slice(0,100);
    const company=(body.company||'').toString().trim().slice(0,120);
    const country=(body.country||'').toString().trim().slice(0,80);
    const message=(body.message||'').toString().slice(0,2000);
    const targetprice=(body.targetprice||'').toString().trim().slice(0,30);
    const incoterm=(body.incoterm||'').toString().trim().slice(0,30);
    const cert=(body.cert||'').toString().trim().slice(0,200);
    const im=(body.im||'').toString().trim().slice(0,100);
    const needSample=body.needSample==='on'||body.needSample===true||body.needSample==='true';
    const needOEM=body.needOEM==='on'||body.needOEM===true||body.needOEM==='true';
    if(!name||!email||!product)return res.status(400).json({ok:false,error:'Name, email and product are required'});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({ok:false,error:'Invalid email'});
    const tags=[];if(needSample)tags.push('[SAMPLE REQUEST]');if(needOEM)tags.push('[OEM/PRIVATE LABEL]');
    const tagStr=tags.length?tags.join(' ')+' ':'';
    const subject=`${tagStr}SealQ B2B Inquiry from ${name}${company?' @ '+company:''}`;
    const textLines=[
      '=== SealQ B2B Inquiry ===',
      `Name: ${name}`,
      `Email: ${email}`,
      company?`Company: ${company}`:'',
      country?`Country: ${country}`:'',
      im?`WhatsApp/WeChat: ${im}`:'',
      '',
      `Product Interest: ${product}`,
      `Quantity: ${quantity||'Not specified'}`,
      targetprice?`Target Price: ${targetprice} USD/pc`:'',
      incoterm?`Preferred Incoterms: ${incoterm}`:'',
      cert?`Required Certifications: ${cert}`:'',
      needSample?'Request: Free sample requested':'',
      needOEM?'Request: OEM / Private Label':'',
      '',
      'Message:',
      message||'(no message)',
      '',
      `Sent from: ${req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown'}`,
      `User-Agent: ${req.headers['user-agent']||'unknown'}`,
      `Time: ${new Date().toISOString()}`,
    ].filter(Boolean);
    const htmlRows=textLines.map(l=>{
      if(l.startsWith('==='))return `<tr><td colspan="2" style="background:#0B5FFF;color:#fff;padding:8px 12px;font-weight:700">${l.replace(/===/g,'').trim()}</td></tr>`;
      if(l.endsWith(':'))return `<tr><td colspan="2" style="padding:6px 12px;font-weight:700;color:#0B5FFF;border-top:1px solid #eee">${l}</td></tr>`;
      const colon=l.indexOf(':');
      if(colon>0){const k=l.substring(0,colon),v=l.substring(colon+1);return `<tr><td style="padding:4px 12px;font-weight:600;color:#333;width:180px;vertical-align:top">${k}</td><td style="padding:4px 12px;color:#555;word-break:break-word">${v||'—'}</td></tr>`}
      return `<tr><td colspan="2" style="padding:6px 12px;color:#444;white-space:pre-wrap">${l}</td></tr>`;
    }).join('');
    const htmlBody=`<!doctype html><html><body style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:20px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
<tr><td style="background:linear-gradient(135deg,#0B5FFF,#0052d9);color:#fff;padding:20px 24px"><h1 style="margin:0;font-size:20px">🔔 New B2B Inquiry — SealQ by QILI Electronics</h1><p style="margin:6px 0 0;opacity:.85;font-size:13px">Submitted via go.freshlocksealer.com</p></td></tr>
<tr><td style="padding:0"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${htmlRows}</table></td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;font-size:12px;color:#888;border-top:1px solid #eee">Reply directly to <a href="mailto:${email}" style="color:#0B5FFF">${email}</a> within 24h (Mon–Sat). · <a href="https://go.freshlocksealer.com" style="color:#0B5FFF">go.freshlocksealer.com</a></td></tr>
</table></body></html>`;
    await sendMail({from:FROM_EMAIL,to:TO_EMAIL,replyTo:email,subject,textBody:textLines.join('\n'),htmlBody});
    return res.status(200).json({ok:true,message:'Inquiry sent successfully'});
  }catch(err){
    console.error('Contact form error:',err);
    return res.status(500).json({ok:false,error:'Failed to send inquiry. Please email directly to jasonyuan866@gmail.com'});
  }
};
