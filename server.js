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

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY não configurada no servidor.' });

  try {
    const groqResponse = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente de reuniões. Leia o texto e extraia os tópicos que devem ser abordados na reunião. ' +
              'Retorne EXCLUSIVAMENTE um objeto JSON com uma chave "topics" contendo um array de strings. ' +
              'Sem markdown, sem explicações extras.'
          },
          {
            role: 'user',
            content: agenda
          }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log('[GROQ] Resposta bruta:', JSON.stringify(groqResponse.data, null, 2));

    const raw = groqResponse.data.choices[0].message.content;
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
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
    console.error('[GROQ] Erro na chamada:', detail);
    return res.status(500).json({
      error: err.response?.data?.error?.message || err.message || 'Erro ao chamar a Groq API.'
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[SERVER] Servidor rodando em http://localhost:${PORT}`);
});
