require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== POST /api/extract-agenda =====
app.post('/api/extract-agenda', async (req, res) => {
  const { agenda } = req.body;

  if (!agenda || !agenda.trim()) {
    return res.status(400).json({ error: 'Pauta não pode estar vazia.' });
  }

  const apiKey  = process.env.TESS_API_KEY;
  const agentId = process.env.TESS_AGENT_ID;

  if (!apiKey)  return res.status(500).json({ error: 'TESS_API_KEY não configurada no servidor.' });
  if (!agentId) return res.status(500).json({ error: 'TESS_AGENT_ID não configurado no servidor.' });

  try {
    const tessResponse = await axios.post(
      `https://tess.pareto.io/api/agents/${agentId}/execute`,
      {
        model: 'tess-5',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente de reuniões. Leia o texto e extraia os tópicos. ' +
              'Retorne EXCLUSIVAMENTE um objeto JSON com uma chave "topics" contendo um array de strings. ' +
              'Sem markdown, sem explicações extras.'
          },
          {
            role: 'user',
            content: agenda
          }
        ],
        temperature: '0.2',
        tools: 'no-tools',
        wait_execution: true
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('[TESS AI] Resposta bruta:', JSON.stringify(tessResponse.data, null, 2));

    const raw = tessResponse.data.output;
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      // Modelo pode ter retornado com bloco markdown ```json ... ```
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error(`IA retornou resposta não-JSON: "${raw}"`);
      }
    }

    if (!parsed.topics || !Array.isArray(parsed.topics)) {
      throw new Error('Resposta da IA sem o campo "topics" esperado.');
    }

    return res.json({ topics: parsed.topics });

  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[TESS AI] Erro na chamada:', detail);
    return res.status(500).json({
      error: err.response?.data?.message || err.message || 'Erro ao chamar a Tess AI.'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[SERVER] Servidor rodando em http://localhost:${PORT}`);
});
