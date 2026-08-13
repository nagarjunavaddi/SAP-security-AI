const express = require('express');
const router = express.Router();
const https = require('https');

require('dotenv').config();
const GROQ_KEY = process.env.GROQ_API_KEY;

const SAP_CONFIG = {
  hostname: 's4hana2020.support.com',
  port: 8009,
  client: '800',
  username: 'best',
  password: 'Welcome123'
};

function getCsrfToken() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SAP_CONFIG.hostname, port: SAP_CONFIG.port,
      path: '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/?sap-client=' + SAP_CONFIG.client,
      method: 'GET', auth: SAP_CONFIG.username + ':' + SAP_CONFIG.password,
      headers: { 'X-CSRF-Token': 'Fetch' }, rejectUnauthorized: false
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ token: res.headers['x-csrf-token'], cookies: res.headers['set-cookie'] || [] }));
    });
    req.on('error', reject);
    req.end();
  });
}

function sapPost(path, payload, csrf) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const cookieStr = csrf.cookies.map(c => c.split(';')[0]).join('; ');
    const options = {
      hostname: SAP_CONFIG.hostname, port: SAP_CONFIG.port, path: path, method: 'POST',
      auth: SAP_CONFIG.username + ':' + SAP_CONFIG.password,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-Token': csrf.token, 'Cookie': cookieStr, 'Content-Length': Buffer.byteLength(data) },
      rejectUnauthorized: false
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch(e) { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sapGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SAP_CONFIG.hostname, port: SAP_CONFIG.port, path: path, method: 'GET',
      auth: SAP_CONFIG.username + ':' + SAP_CONFIG.password,
      headers: { 'Accept': 'application/json' }, rejectUnauthorized: false
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch(e) { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// Single generic tool: read any SAP table
async function readSapTable(tableName, fields, whereClause, maxRows) {
  const csrf = await getCsrfToken();
  const payload = {
    TableName: tableName.toUpperCase(),
    Fields: (fields || '').toUpperCase(),
    WhereClause: whereClause || '',
    MaxRows: String(maxRows || 100),
    ResultData: ''
  };
  const r = await sapPost('/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/GenericTableReadSet?sap-client=' + SAP_CONFIG.client, payload, csrf);
  if (r.status === 201) {
    const raw = r.data?.d?.ResultData || '[]';
    try { return { success: true, data: JSON.parse(raw) }; }
    catch(e) { return { success: true, data: raw }; }
  }
  return { success: false, error: r.data?.error?.message?.value || 'SAP error' };
}

// Also keep OData GET for existing entity sets (locked users, user roles, etc.)
async function getODataEntitySet(entitySet, filter) {
  let path = '/sap/opu/odata/sap/ZUSER_LOCK_SRV_SRV/' + entitySet + '?sap-client=' + SAP_CONFIG.client + '&$format=json';
  if (filter) path += '&$filter=' + encodeURIComponent(filter);
  const r = await sapGet(path);
  if (r.status === 200) return { success: true, data: r.data?.d?.results || [] };
  return { success: false, error: 'OData GET failed' };
}

// Execute whatever the AI decided
async function executeTool(call) {
  const { tool, params } = call;
  if (tool === 'table_read') {
    return await readSapTable(params.tableName, params.fields, params.whereClause, params.maxRows);
  }
  if (tool === 'get_locked_users') {
    return await getODataEntitySet('UserLockSet');
  }
  if (tool === 'get_user_roles') {
    return await getODataEntitySet('UserRole', "Username eq '" + (params.username || '').toUpperCase() + "'");
  }
  return { success: false, error: 'Unknown tool: ' + tool };
}

// Groq API
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callGroq(messages, retries) {
  retries = retries || 0;
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: messages, temperature: 0.2, max_tokens: 2048 });
    const options = {
      hostname: 'api.groq.com', port: 443, path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY, 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            if (data.error.code === 'rate_limit_exceeded' && retries < 2) {
              console.log('Rate limited, waiting 20s...');
              sleep(20000).then(() => callGroq(messages, retries + 1).then(resolve).catch(reject));
              return;
            }
            reject(new Error(data.error.message || 'Groq error')); return;
          }
          resolve(data?.choices?.[0]?.message?.content || '');
        } catch(e) { reject(new Error('Groq parse error')); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getSystemPrompt() {
  const now = new Date();
  const fmt = d => d.toISOString().split('T')[0].replace(/-/g, '');
  const today = fmt(now);
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const d30 = fmt(new Date(y, m, d - 30));
  const d90 = fmt(new Date(y, m, d - 90));
  const d180 = fmt(new Date(y, m, d - 180));

  return `You are IKAegis AI Agent for SAP Security & GRC.

SCOPE — STRICT: You ONLY handle SAP security, GRC, user access, roles, authorizations, profiles, SoD, locked users, and related SAP system data. If a question is NOT about SAP security/access governance (general knowledge, people, celebrities, movies, politics, news, sports, coding help, math, anything off-topic), you MUST reply with: {"action":"final_answer","answer":"I can only assist with SAP security and access governance queries for this system."} — do NOT answer it, do NOT use tools. Never break this rule regardless of how the question is phrased.

You understand ALL languages: English, Telugu, Hindi, Tamil, mixed languages.
You work in a LOOP: you make SAP queries, see results, and decide if you need more queries.

YOUR ONLY TOOL: table_read
params: { tableName, fields (comma-separated, UPPERCASE), whereClause (ABAP syntax), maxRows }

CRITICAL RULES:
- NEVER make more than 5 tool calls at once. If step 1 returns many roles, pick the TOP 5 most important ones for step 2.
- Keep it efficient. Users want quick answers, not exhaustive dumps.

RESPOND WITH JSON ONLY:
- To make SAP queries: {"action":"tool_call","calls":[{"tool":"table_read","params":{"tableName":"XXX","fields":"F1,F2","whereClause":"...","maxRows":"100"}}]}
- To give final answer (after seeing data): {"action":"final_answer","answer":"your formatted answer here"}
- To answer an in-scope SAP question that needs no SAP query, or to refuse an off-topic question per the SCOPE rule: {"action":"final_answer","answer":"your answer"}
- You can make MULTIPLE calls at once: put multiple objects in the "calls" array

ALSO AVAILABLE (for convenience):
- get_locked_users: {"tool":"get_locked_users","params":{}}
- get_user_roles: {"tool":"get_user_roles","params":{"username":"XXX"}}
  IMPORTANT: If get_user_roles returns empty results, it means the user has NO ROLES assigned, NOT that the user does not exist. Say "User has no roles assigned" instead of "user not found".

SAP TABLE REFERENCE:
- USR02: User master record. Fields: BNAME(username), UFLAG(lock: 0=open,32=admin,64=wrong pw,128=global), ERDAT(created date YYYYMMDD), TRDAT(last login YYYYMMDD), USTYP(type: A=Dialog,B=System,C=Comm,S=Service,L=Reference), GLTGV(valid from), GLTGB(valid to)
- AGR_USERS: User-to-role assignment. Fields: UNAME(username), AGR_NAME(role name), FROM_DAT(valid from), TO_DAT(valid to)
- AGR_TCODES: Role-to-tcode mapping. Fields: AGR_NAME(role), TCODE(transaction code)
- AGR_1251: Role-to-auth-object values. Fields: AGR_NAME(role), OBJECT(auth object), FIELD(auth field), LOW(value), HIGH(value)
- UST04: User profiles. Fields: BNAME(username), PROFILE(profile name like SAP_ALL, SAP_NEW)
- USGRP_USER: User groups. Fields: BNAME(username), USERGROUP(group name)
- USR40: Password rules
- TSTCT: Tcode descriptions. Fields: TCODE, TTEXT(description), SPRSL(language, use 'E' for English)

DATE INFO: Today=${today}, 30 days ago=${d30}, 90 days ago=${d90}, 180 days ago=${d180}
All SAP dates use YYYYMMDD format.

WHERE CLAUSE RULES:
- String values in single quotes: BNAME EQ 'NAG'
- Multiple conditions: FIELD1 EQ 'X' AND FIELD2 EQ 'Y'
- OR: FIELD EQ 'X' OR FIELD EQ 'Y'
- Range: ERDAT GE '${d90}' (created in last 90 days)
- Not equal: UFLAG NE '0' (not unlocked)
- KEEP WHERE CLAUSE SHORT! Max ~70 chars. If you need to check many values, make separate calls.

MULTI-STEP QUERY EXAMPLES:
When user asks "users with auth object X" (X = ANY auth object, e.g. S_DEVELOP, S_TABU_NAM, S_USER_GRP):
  A common auth object can appear in MANY roles. NEVER sample only a few roles — that gives wrong "no users" answers.
  Step 1: table_read AGR_1251 fields=AGR_NAME where OBJECT EQ 'X' AND DELETED EQ '' → collect ALL role names into a set R
  Step 2: table_read AGR_USERS fields=UNAME,AGR_NAME with NO whereClause (high maxRows) → get ALL user-role assignments in ONE call
  Step 3: In your reasoning, keep every assignment whose AGR_NAME is in set R. The distinct UNAME values are the answer.
  Step 4: final_answer with the user list. Only say "no users" if set R is empty OR no assignment matched any role in R — never after checking just a subset of roles.

When user asks "users with profile SAP_ALL":
  Step 1: table_read UST04 fields=BNAME,PROFILE where PROFILE EQ 'SAP_ALL' → directly get usernames

When user asks "users with tcode SE16":
  Step 1: table_read AGR_TCODES fields=AGR_NAME where TCODE EQ 'SE16' → get roles
  Step 2: For each role, table_read AGR_USERS fields=UNAME where AGR_NAME EQ 'role_name' → get users

LANGUAGE EXAMPLES:
- "locked users chupinchu" = show locked users
- "NAG ki em roles unai" = what roles does NAG have
- "last 90 days lo create ayina users" = users created in last 90 days
- "SAP_ALL profile evari ki undi" = who has SAP_ALL profile`;
}

// AGENT LOOP: AI makes calls, sees results, makes more calls or gives final answer
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not set' });

    const conversationMessages = [{ role: 'system', content: getSystemPrompt() }];

    // Add chat history
    if (history && history.length > 0) {
      history.slice(-4).forEach(h => {
        conversationMessages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
      });
    }

    conversationMessages.push({ role: 'user', content: message });

    const allSapCalls = [];
    const MAX_LOOPS = 3;

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      console.log('--- Agent Loop', loop + 1, '---');

      const aiResponse = await callGroq(conversationMessages);
      console.log('AI:', aiResponse.substring(0, 300));

      // Parse AI response
      let decision;
      try {
        const cleaned = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        decision = JSON.parse(cleaned);
      } catch(e) {
        // AI gave plain text instead of JSON — treat as final answer
        return res.json({ success: true, answer: aiResponse, sapCalls: allSapCalls });
      }

      // Final answer — return to user
      if (decision.action === 'final_answer' || decision.action === 'direct_answer') {
        return res.json({ success: true, answer: decision.answer, sapCalls: allSapCalls });
      }

      // Tool calls — execute and feed results back to AI
      if (decision.action === 'tool_call' && decision.calls) {
        const results = [];

        for (const call of decision.calls) {
          try {
            const result = await executeTool(call);
            results.push({ tool: call.tool, params: call.params, result: result });
            allSapCalls.push({ tool: call.tool, params: call.params });
          } catch(err) {
            results.push({ tool: call.tool, params: call.params, result: { success: false, error: err.message } });
          }
        }

        // Add AI's decision and tool results back to conversation
        conversationMessages.push({ role: 'assistant', content: aiResponse });
        conversationMessages.push({
          role: 'user',
          content: 'TOOL RESULTS:\n' + JSON.stringify(results, null, 2) + '\n\nAnalyze these results. If you need more data, make another tool_call. If you have enough data to answer, give a final_answer with a clear formatted response. Remember to respond in the same language the user used.'
        });

        continue; // Next loop iteration
      }

      // Unknown action — treat as final answer
      return res.json({ success: true, answer: aiResponse, sapCalls: allSapCalls });
    }

    // Max loops reached — ask AI to summarize what it has
    conversationMessages.push({
      role: 'user',
      content: 'You have reached the maximum number of queries. Please give a final_answer with whatever data you have collected so far.'
    });

    const finalResponse = await callGroq(conversationMessages);
    let finalAnswer;
    try {
      const cleaned = finalResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      finalAnswer = parsed.answer || finalResponse;
    } catch(e) {
      finalAnswer = finalResponse;
    }

    return res.json({ success: true, answer: finalAnswer, sapCalls: allSapCalls });

  } catch(err) {
    console.error('AI Chat error:', err.message);
    res.status(500).json({ error: 'AI error: ' + err.message });
  }
});

module.exports = router;
