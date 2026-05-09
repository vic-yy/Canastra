// ===== ELEMENTOS DA UI =====
const agendaInput      = document.getElementById('agenda-input');
const btnProcess       = document.getElementById('btn-process');
const topicsList       = document.getElementById('topics-list');
const uploadZone       = document.getElementById('upload-zone');
const fileInput        = document.getElementById('file-input');
const btnBrowse        = document.getElementById('btn-browse');
const btnClearTopics   = document.getElementById('btn-clear-topics');
const btnStart         = document.getElementById('btn-start');
const btnAnalyze       = document.getElementById('btn-analyze');
const btnEnd           = document.getElementById('btn-end');
const btnReport        = document.getElementById('btn-report');
const btnCopyReport    = document.getElementById('btn-copy-report');
const btnDownloadPdf   = document.getElementById('btn-download-pdf');
const statusBar        = document.getElementById('status-bar');
const statusText       = document.getElementById('status-text');
const transcription    = document.getElementById('transcription');
const reportSection    = document.getElementById('report-section');
const reportOutput     = document.getElementById('report-output');

// ===== ESTADO DA APLICAÇÃO =====
let isListening      = false;
let recognition      = null;
let fullTranscript   = '';  // texto de sessões encerradas
let sessionTranscript = ''; // texto acumulado da sessão ativa

// ===== SPEECH RECOGNITION SETUP =====
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function initRecognition() {
  if (!SpeechRecognition) {
    console.error('[SPEECH] Web Speech API não é suportada neste navegador.');
    alert('Seu navegador não suporta a Web Speech API. Use o Google Chrome ou Edge.');
    return null;
  }

  const rec = new SpeechRecognition();
  rec.lang = 'pt-BR';
  rec.continuous = true;
  rec.interimResults = true;

  rec.onstart = () => {
    console.log('[MIC] Microfone ativado. Ouvindo...');
    setStatus('listening', 'Ouvindo...');
  };

  rec.onresult = (event) => {
    // Reconstrói o transcript completo da sessão a partir de todos os resultados
    // (finais e interim). Isso garante que cada palavra apareça imediatamente
    // e nunca suma — sem depender de isFinal para persistir o texto.
    let text = '';
    for (let i = 0; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
      if (i < event.results.length - 1) text += ' ';
    }
    sessionTranscript = text;

    transcription.value = fullTranscript + (fullTranscript && sessionTranscript ? ' ' : '') + sessionTranscript;
    transcription.scrollTop = transcription.scrollHeight;

    const latest = event.results[event.resultIndex][0].transcript.trim();
    if (latest) console.log('[TRANSCRIÇÃO]', latest);
  };

  rec.onerror = (event) => {
    console.error('[SPEECH] Erro no reconhecimento de voz:', event.error);
    if (event.error === 'not-allowed') {
      alert('Permissão de microfone negada. Verifique as configurações do navegador.');
      stopListening();
    }
  };

  rec.onend = () => {
    // Commita o texto da sessão encerrada em fullTranscript antes de reiniciar
    if (sessionTranscript.trim()) {
      fullTranscript = (fullTranscript + ' ' + sessionTranscript).trim() + ' ';
      console.log('[MIC] Sessão encerrada. Texto salvo:', sessionTranscript.trim());
      sessionTranscript = '';
      transcription.value = fullTranscript;
    }
    if (isListening) {
      console.log('[MIC] Reiniciando sessão...');
      rec.start();
    }
  };

  return rec;
}

// ===== CONTROLE DE STATUS =====
function setStatus(state, text) {
  statusBar.className = 'status-bar status-bar--' + state;
  statusText.textContent = text;
}

// ===== INICIAR / PARAR LISTENING =====
function startListening() {
  recognition = initRecognition();
  if (!recognition) return;

  isListening = true;
  recognition.start();

  btnStart.textContent   = '⏸ Pausar Microfone';
  btnStart.className     = 'btn btn--secondary';
  btnAnalyze.disabled    = false;
  btnEnd.disabled        = false;

  console.log('[APP] Reunião iniciada.');
}

function stopListening() {
  if (!recognition) return;

  isListening = false;
  // onend vai committar sessionTranscript automaticamente
  recognition.stop();
  recognition = null;

  btnStart.textContent = '🎙 Retomar Microfone';
  btnStart.className   = 'btn btn--success';
  setStatus('stopped', 'Microfone pausado');

  console.log('[MIC] Microfone pausado.');
}

// ===== UPLOAD DE BRIEFING =====
btnBrowse.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('click', (e) => {
  if (e.target !== btnBrowse) fileInput.click();
});

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processUpload(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) processUpload(fileInput.files[0]);
  fileInput.value = '';
});

async function processUpload(file) {
  const allowed = ['.pdf', '.docx', '.txt'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    alert('Formato não suportado. Use PDF, DOCX ou TXT.');
    return;
  }

  uploadZone.querySelector('.upload-zone__content').innerHTML =
    `<span class="upload-zone__icon">⏳</span><p class="upload-zone__text">Extraindo texto de <strong>${escapeHtml(file.name)}</strong>...</p>`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/upload-briefing', { method: 'POST', body: formData });
    const data = await response.json();

    if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);

    agendaInput.value = data.text;
    uploadZone.classList.add('upload-zone--success');
    uploadZone.querySelector('.upload-zone__content').innerHTML =
      `<span class="upload-zone__icon">✅</span>` +
      `<p class="upload-zone__filename">${escapeHtml(data.filename)}</p>` +
      `<p class="upload-zone__hint">Texto extraído. Edite a pauta ou clique em Processar.</p>`;

    console.log(`[UPLOAD] "${data.filename}" — ${data.text.length} caracteres carregados na pauta.`);

  } catch (err) {
    console.error('[UPLOAD] Erro:', err);
    alert(`Erro ao processar arquivo:\n${err.message}`);
    uploadZone.classList.remove('upload-zone--success');
    uploadZone.querySelector('.upload-zone__content').innerHTML =
      `<span class="upload-zone__icon">📎</span>` +
      `<p class="upload-zone__text">Arraste um arquivo ou <button class="btn-link" id="btn-browse">clique para selecionar</button></p>` +
      `<p class="upload-zone__hint">PDF, DOCX ou TXT — máx. 10 MB</p>`;
    document.getElementById('btn-browse').addEventListener('click', () => fileInput.click());
  }
}

// ===== LIMPAR CHECKBOXES =====
btnClearTopics.addEventListener('click', () => {
  const items = topicsList.querySelectorAll('.topic-tab');
  if (items.length === 0) return;

  items.forEach(li => {
    li.classList.remove('done', 'expanded', 'covered');
    li.querySelector('input[type="checkbox"]').checked = false;
    const inner = li.querySelector('.topic-tab__body-inner');
    if (inner) inner.innerHTML = '<p class="topic-tab__empty">Nenhuma análise disponível ainda.</p>';
  });

  console.log('[TÓPICOS] Todos os checkboxes foram limpos.');
});

// ===== PROCESSAR PAUTA (via Groq) =====
btnProcess.addEventListener('click', async () => {
  const rawText = agendaInput.value.trim();

  if (!rawText) {
    alert('Cole o texto da pauta antes de processar.');
    return;
  }

  btnProcess.disabled    = true;
  btnProcess.textContent = 'Processando...';

  try {
    const response = await fetch('/api/extract-agenda', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agenda: rawText })
    });

    const data = await response.json();
    console.log('[APP] Resposta de /api/extract-agenda:', data);

    if (!response.ok) {
      throw new Error(data.error || `Erro HTTP ${response.status}`);
    }

    renderTopics(data.topics);

  } catch (err) {
    console.error('[APP] Falha ao processar pauta:', err);
    alert(`Erro ao processar a pauta:\n${err.message}`);
  } finally {
    btnProcess.disabled    = false;
    btnProcess.textContent = 'Processar Pauta';
  }
});

function renderTopics(topics) {
  topicsList.innerHTML = '';

  if (!topics || topics.length === 0) {
    topicsList.innerHTML = '<li class="topics-empty">Nenhum tópico encontrado.</li>';
    return;
  }

  topics.forEach((topic, index) => {
    const id = `topic-${index}`;
    const li = document.createElement('li');
    li.className = 'topic-tab';
    li.dataset.index = index;

    li.innerHTML = `
      <div class="topic-tab__header">
        <input type="checkbox" id="${id}" />
        <label for="${id}">${escapeHtml(topic)}</label>
        <span class="topic-tab__arrow">▾</span>
      </div>
      <div class="topic-tab__body">
        <div class="topic-tab__body-inner">
          <p class="topic-tab__empty">Nenhuma análise disponível ainda.</p>
        </div>
      </div>
    `;

    li.querySelector('input').addEventListener('change', (e) => {
      li.classList.toggle('done', e.target.checked);
      console.log(`[TÓPICO] "${topic}" marcado como ${e.target.checked ? 'concluído' : 'pendente'}.`);
    });

    li.querySelector('.topic-tab__header').addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      li.classList.toggle('expanded');
    });

    topicsList.appendChild(li);
  });

  console.log(`[PAUTA] ${topics.length} tópico(s) renderizados:`, topics);
}

// ===== BOTÃO INICIAR / PAUSAR =====
btnStart.addEventListener('click', () => {
  if (!isListening) {
    startListening();
  } else {
    stopListening();
  }
});

// ===== BOTÃO ANALISAR PROGRESSO =====
btnAnalyze.addEventListener('click', async () => {
  const items = topicsList.querySelectorAll('.topic-tab');

  if (items.length === 0) {
    alert('Processe a pauta antes de analisar o progresso.');
    return;
  }

  const transcript = fullTranscript.trim();
  if (!transcript) {
    alert('Nenhuma transcrição disponível ainda. Inicie a reunião e fale algo.');
    return;
  }

  const topics = Array.from(items).map(li => li.querySelector('label').textContent);

  btnAnalyze.disabled    = true;
  btnAnalyze.textContent = 'Analisando...';

  try {
    const response = await fetch('/api/analyze-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topics, transcription: transcript })
    });

    const data = await response.json();
    console.log('[APP] Resposta de /api/analyze-progress:', data);

    if (!response.ok) {
      throw new Error(data.error || `Erro HTTP ${response.status}`);
    }

    // Popula cada aba com o resultado da análise
    items.forEach((li) => {
      const i      = parseInt(li.dataset.index);
      const result = data.results.find(r => r.index === i);
      if (!result) return;

      const checkbox = li.querySelector('input[type="checkbox"]');
      const inner    = li.querySelector('.topic-tab__body-inner');

      if (result.covered) {
        checkbox.checked = true;
        li.classList.add('done', 'covered', 'expanded');
        inner.innerHTML = `
          <div class="topic-tab__section">
            <span class="topic-tab__tag">Trecho</span>
            <blockquote class="topic-tab__quote">${escapeHtml(result.excerpt)}</blockquote>
          </div>
          <div class="topic-tab__section">
            <span class="topic-tab__tag">Resumo</span>
            <p class="topic-tab__summary-text">${escapeHtml(result.summary)}</p>
          </div>
        `;
      }
    });

    const total   = items.length;
    const covered = data.results.filter(r => r.covered).length;
    console.log(`[ANÁLISE] IA identificou ${covered} de ${total} tópico(s) abordados.`);

  } catch (err) {
    console.error('[APP] Falha ao analisar progresso:', err);
    alert(`Erro ao analisar progresso:\n${err.message}`);
  } finally {
    btnAnalyze.disabled    = false;
    btnAnalyze.textContent = 'Analisar Progresso';
  }
});

// ===== BOTÃO FINALIZAR =====
btnEnd.addEventListener('click', () => {
  if (!confirm('Deseja finalizar a reunião? O microfone será desligado.')) return;

  if (isListening) stopListening();

  isListening = false;
  setStatus('stopped', 'Reunião finalizada');

  btnStart.disabled   = true;
  btnAnalyze.disabled = true;
  btnEnd.disabled     = true;
  btnReport.disabled  = false;

  const words = fullTranscript.trim().split(/\s+/).filter(Boolean).length;
  console.log('[APP] Reunião finalizada.');
  console.log(`[APP] Transcrição final (${words} palavras):`, fullTranscript);
});

// ===== BOTÃO GERAR RELATÓRIO =====
btnReport.addEventListener('click', async () => {
  const transcript = fullTranscript.trim();
  if (!transcript) {
    alert('Nenhuma transcrição disponível para gerar o relatório.');
    return;
  }

  const topicItems = topicsList.querySelectorAll('.topic-tab');
  if (topicItems.length === 0) {
    alert('Nenhum tópico encontrado. Processe a pauta antes de gerar o relatório.');
    return;
  }

  const topics = Array.from(topicItems).map(li => ({
    text:    li.querySelector('label').textContent,
    checked: li.querySelector('input[type="checkbox"]').checked
  }));

  btnReport.disabled    = true;
  btnReport.textContent = 'Gerando...';
  reportSection.classList.add('report-section--hidden');

  try {
    const response = await fetch('/api/generate-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcription: transcript, topics })
    });

    const data = await response.json();
    console.log('[APP] Resposta de /api/generate-report:', data);

    if (!response.ok) {
      throw new Error(data.error || `Erro HTTP ${response.status}`);
    }

    reportOutput.textContent = data.report;
    reportSection.classList.remove('report-section--hidden');
    reportSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    console.error('[APP] Falha ao gerar relatório:', err);
    alert(`Erro ao gerar relatório:\n${err.message}`);
  } finally {
    btnReport.disabled    = false;
    btnReport.textContent = 'Gerar Relatório';
  }
});

// ===== BOTÃO COPIAR RELATÓRIO =====
btnCopyReport.addEventListener('click', async () => {
  const text = reportOutput.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    btnCopyReport.textContent = 'Copiado!';
    setTimeout(() => { btnCopyReport.textContent = 'Copiar'; }, 2000);
  } catch {
    alert('Não foi possível copiar. Selecione o texto manualmente.');
  }
});

// ===== BOTÃO BAIXAR PDF =====
btnDownloadPdf.addEventListener('click', async () => {
  const text = reportOutput.textContent;
  if (!text) return;

  btnDownloadPdf.textContent = 'Gerando...';
  btnDownloadPdf.style.pointerEvents = 'none';

  try {
    const response = await fetch('/api/report-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report: text })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || `Erro HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `relatorio-${new Date().toISOString().split('T')[0]}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    console.log('[PDF] Download iniciado.');
  } catch (err) {
    console.error('[PDF] Falha ao gerar PDF:', err);
    alert(`Erro ao gerar PDF:\n${err.message}`);
  } finally {
    btnDownloadPdf.textContent  = 'Baixar PDF';
    btnDownloadPdf.style.pointerEvents = '';
  }
});

// ===== UTIL =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
