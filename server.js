require('dotenv').config();

const express     = require('express');
const axios       = require('axios');
const path        = require('path');
const PDFDocument = require('pdfkit');
const multer      = require('multer');
const pdfParse    = require('pdf-parse');
const mammoth     = require('mammoth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.docx', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error('Formato não suportado. Use PDF, DOCX ou TXT.'));
  }
});

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== POST /api/upload-briefing =====
app.post('/api/upload-briefing', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo recebido.' });

  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    let text = '';

    if (ext === '.txt') {
      text = req.file.buffer.toString('utf-8');
    } else if (ext === '.pdf') {
      const data = await pdfParse(req.file.buffer);
      text = data.text;
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    }

    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!text) return res.status(422).json({ error: 'Não foi possível extrair texto do arquivo.' });

    console.log(`[UPLOAD] ${req.file.originalname} (${ext}) — ${text.length} caracteres extraídos.`);
    return res.json({ text, filename: req.file.originalname });

  } catch (err) {
    console.error('[UPLOAD] Erro ao processar arquivo:', err.message);
    return res.status(500).json({ error: `Erro ao processar arquivo: ${err.message}` });
  }
});

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

// ===== POST /api/analyze-progress =====
app.post('/api/analyze-progress', async (req, res) => {
  const { topics, transcription } = req.body;

  if (!topics || !Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'Lista de tópicos ausente ou vazia.' });
  }
  if (!transcription || !transcription.trim()) {
    return res.status(400).json({ error: 'Transcrição ausente ou vazia.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY não configurada no servidor.' });

  const topicsList = topics.map((t, i) => `${i}. ${t}`).join('\n');

  try {
    const groqResponse = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente de reuniões. Para cada tópico da lista, analise a transcrição e:\n' +
              '1. Determine se o tópico foi abordado (covered: true/false)\n' +
              '2. Se foi abordado: extraia o trecho mais relevante da transcrição (citação direta, máximo 3 frases)\n' +
              '3. Se foi abordado: escreva um resumo conciso do que foi discutido (máximo 2 frases)\n\n' +
              'Retorne EXCLUSIVAMENTE um objeto JSON com o formato:\n' +
              '{"results":[{"index":0,"covered":true,"excerpt":"trecho direto da transcrição","summary":"resumo do que foi discutido"},{"index":1,"covered":false,"excerpt":null,"summary":null}]}\n' +
              'Sem markdown, sem explicações extras. Um objeto por tópico, na mesma ordem da lista.'
          },
          {
            role: 'user',
            content: `Tópicos planejados:\n${topicsList}\n\nTranscrição da reunião:\n${transcription}`
          }
        ],
        temperature: 0.1,
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

    console.log('[GROQ] Análise de progresso:', JSON.stringify(groqResponse.data, null, 2));

    const raw = groqResponse.data.choices[0].message.content;
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.results)) {
      throw new Error('Resposta da IA sem o campo "results" esperado.');
    }

    return res.json({ results: parsed.results });

  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[GROQ] Erro na análise:', detail);
    return res.status(500).json({
      error: err.response?.data?.error?.message || err.message || 'Erro ao analisar progresso.'
    });
  }
});

// ===== POST /api/generate-report =====
app.post('/api/generate-report', async (req, res) => {
  const { transcription, topics } = req.body;

  if (!transcription || !transcription.trim()) {
    return res.status(400).json({ error: 'Transcrição ausente ou vazia.' });
  }
  if (!topics || !Array.isArray(topics) || topics.length === 0) {
    return res.status(400).json({ error: 'Lista de tópicos ausente ou vazia.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY não configurada no servidor.' });

  const abordados = topics.filter(t => t.checked).map(t => `✓ ${t.text}`).join('\n') || 'Nenhum';
  const pendentes = topics.filter(t => !t.checked).map(t => `✗ ${t.text}`).join('\n') || 'Nenhum';

  try {
    const groqResponse = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente de reuniões. Gere um relatório profissional e estruturado da reunião ' +
              'com base na transcrição e nos tópicos fornecidos. ' +
              'O relatório deve conter: data/contexto (se inferível), resumo executivo, ' +
              'tópicos abordados com seus principais pontos, tópicos não cobertos e próximos passos sugeridos. ' +
              'Escreva em português, em formato de texto corrido com seções bem definidas.'
          },
          {
            role: 'user',
            content:
              `TÓPICOS ABORDADOS:\n${abordados}\n\n` +
              `TÓPICOS NÃO ABORDADOS:\n${pendentes}\n\n` +
              `TRANSCRIÇÃO DA REUNIÃO:\n${transcription}`
          }
        ],
        temperature: 0.4
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );

    console.log('[GROQ] Relatório gerado:', JSON.stringify(groqResponse.data, null, 2));

    const report = groqResponse.data.choices[0].message.content;
    if (!report) throw new Error('Groq não retornou conteúdo.');

    return res.json({ report });

  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('[GROQ] Erro ao gerar relatório:', detail);
    return res.status(500).json({
      error: err.response?.data?.error?.message || err.message || 'Erro ao gerar relatório.'
    });
  }
});

// ===== POST /api/report-pdf =====
app.post('/api/report-pdf', (req, res) => {
  const { report } = req.body;

  if (!report || !report.trim()) {
    return res.status(400).json({ error: 'Conteúdo do relatório ausente.' });
  }

  const date = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });
  const filename = `relatorio-${new Date().toISOString().split('T')[0]}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 60, size: 'A4' });
  doc.pipe(res);

  // Cabeçalho
  doc
    .fontSize(22).font('Helvetica-Bold').fillColor('#1a1d27')
    .text('Relatório de Reunião', { align: 'center' });

  doc
    .fontSize(10).font('Helvetica').fillColor('#666')
    .text(date, { align: 'center' });

  doc.moveDown(1.5);

  // Linha divisória
  doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor('#cccccc').lineWidth(1).stroke();
  doc.moveDown(1);

  // Corpo — interpreta seções do texto gerado pelo Groq
  const lines = report.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      doc.moveDown(0.4);
      continue;
    }

    // Markdown ## ou # → título de seção
    if (/^#{1,2}\s+/.test(trimmed)) {
      const text = trimmed.replace(/^#{1,2}\s+/, '');
      doc.moveDown(0.5)
        .fontSize(13).font('Helvetica-Bold').fillColor('#2c3060')
        .text(text);
      doc.moveDown(0.2);
      continue;
    }

    // Linha toda em MAIÚSCULAS curta → título de seção
    const upper = trimmed.toUpperCase();
    if (trimmed === upper && trimmed.length >= 4 && trimmed.length <= 80 && /[A-ZÁÉÍÓÚÀÊÔÃÕÜÇ]/.test(trimmed)) {
      doc.moveDown(0.5)
        .fontSize(12).font('Helvetica-Bold').fillColor('#2c3060')
        .text(trimmed);
      doc.moveDown(0.2);
      continue;
    }

    // Linha terminando com : e curta → sub-título
    if (trimmed.endsWith(':') && trimmed.length <= 60 && !trimmed.startsWith('-')) {
      doc.moveDown(0.3)
        .fontSize(11).font('Helvetica-Bold').fillColor('#333')
        .text(trimmed);
      doc.moveDown(0.1);
      continue;
    }

    // Item de lista
    if (/^[-•*]\s/.test(trimmed) || trimmed.startsWith('[x]') || trimmed.startsWith('[ ]')) {
      const bullet = trimmed.replace(/^[-•*]\s/, '').replace(/^\[[x ]\]\s?/, '');
      doc.fontSize(10).font('Helvetica').fillColor('#222')
        .text(`• ${bullet}`, { indent: 16 });
      continue;
    }

    // Remove marcação markdown restante (**bold**, _italic_)
    const clean = trimmed.replace(/\*\*(.+?)\*\*/g, '$1').replace(/_(.+?)_/g, '$1');
    doc.fontSize(10).font('Helvetica').fillColor('#222')
      .text(clean, { align: 'justify' });
  }

  // Rodapé
  const pageCount = doc.bufferedPageRange ? doc.bufferedPageRange().count : 1;
  doc.fontSize(8).fillColor('#aaa')
    .text(`Gerado por Canastra • ${date}`, 60, doc.page.height - 40, {
      align: 'center', width: doc.page.width - 120
    });

  doc.end();
  console.log(`[PDF] Relatório gerado: ${filename} (${pageCount} página(s))`);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Garante JSON mesmo em rotas não encontradas ou erros não tratados
app.use((req, res) => {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  console.error('[SERVER] Erro não tratado:', err);
  res.status(500).json({ error: err.message || 'Erro interno do servidor.' });
});

app.listen(PORT, () => {
  console.log(`[SERVER] Servidor rodando em http://localhost:${PORT}`);
});
