// ===== ELEMENTOS DA UI =====
const agendaInput    = document.getElementById('agenda-input');
const btnProcess     = document.getElementById('btn-process');
const topicsList     = document.getElementById('topics-list');
const btnStart       = document.getElementById('btn-start');
const btnAnalyze     = document.getElementById('btn-analyze');
const btnEnd         = document.getElementById('btn-end');
const statusBar      = document.getElementById('status-bar');
const statusText     = document.getElementById('status-text');
const transcription  = document.getElementById('transcription');

// ===== ESTADO DA APLICAÇÃO =====
let isListening = false;
let recognition = null;
let fullTranscript = '';
let currentInterim = '';

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
    let interimText = '';
    let newFinal = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        newFinal += result[0].transcript + ' ';
      } else {
        interimText += result[0].transcript;
      }
    }

    if (newFinal) {
      fullTranscript += newFinal;
      currentInterim = '';
      console.log('[TRANSCRIÇÃO] Texto confirmado:', newFinal.trim());
    }

    currentInterim = interimText;
    transcription.value = fullTranscript + currentInterim;
    transcription.scrollTop = transcription.scrollHeight;

    if (interimText) {
      console.log('[TRANSCRIÇÃO] Texto interim (provisório):', interimText);
    }
  };

  rec.onerror = (event) => {
    console.error('[SPEECH] Erro no reconhecimento de voz:', event.error);
    if (event.error === 'not-allowed') {
      alert('Permissão de microfone negada. Verifique as configurações do navegador.');
      stopListening();
    }
  };

  // O Chrome encerra a sessão após ~8s de silêncio mesmo com continuous:true.
  // Antes de reiniciar, salvamos qualquer texto interim que ainda não foi confirmado.
  rec.onend = () => {
    console.log('[MIC] Sessão de reconhecimento encerrada.');
    if (currentInterim) {
      fullTranscript += currentInterim + ' ';
      console.log('[MIC] Texto interim preservado no restart:', currentInterim.trim());
      currentInterim = '';
      transcription.value = fullTranscript;
    }
    if (isListening) {
      console.log('[MIC] Reiniciando sessão automaticamente...');
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
  if (currentInterim) {
    fullTranscript += currentInterim + ' ';
    currentInterim = '';
    transcription.value = fullTranscript;
  }
  recognition.stop();
  recognition = null;

  btnStart.textContent = '🎙 Retomar Microfone';
  btnStart.className   = 'btn btn--success';
  setStatus('stopped', 'Microfone pausado');

  console.log('[MIC] Microfone pausado.');
}

// ===== PROCESSAR PAUTA =====
btnProcess.addEventListener('click', () => {
  const rawText = agendaInput.value.trim();

  if (!rawText) {
    alert('Cole o texto da pauta antes de processar.');
    return;
  }

  const lines = rawText
    .split('\n')
    .map(line => line.replace(/^[-•*\d.]+\s*/, '').trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    alert('Nenhum tópico encontrado. Verifique o formato da pauta.');
    return;
  }

  topicsList.innerHTML = '';

  lines.forEach((topic, index) => {
    const id = `topic-${index}`;
    const li = document.createElement('li');
    li.className = 'topic-item';
    li.dataset.index = index;

    li.innerHTML = `
      <input type="checkbox" id="${id}" />
      <label for="${id}">${escapeHtml(topic)}</label>
    `;

    li.querySelector('input').addEventListener('change', (e) => {
      li.classList.toggle('done', e.target.checked);
      console.log(`[TÓPICO] "${topic}" marcado como ${e.target.checked ? 'concluído' : 'pendente'}.`);
    });

    topicsList.appendChild(li);
  });

  console.log(`[PAUTA] ${lines.length} tópico(s) processado(s):`, lines);
});

// ===== BOTÃO INICIAR / PAUSAR =====
btnStart.addEventListener('click', () => {
  if (!isListening) {
    startListening();
  } else {
    stopListening();
  }
});

// ===== BOTÃO ANALISAR PROGRESSO =====
btnAnalyze.addEventListener('click', () => {
  const total   = topicsList.querySelectorAll('.topic-item').length;
  const done    = topicsList.querySelectorAll('.topic-item.done').length;
  const pending = total - done;
  const words   = fullTranscript.trim().split(/\s+/).filter(Boolean).length;

  console.log(`[ANÁLISE] Progresso da reunião:`);
  console.log(`  - Tópicos totais : ${total}`);
  console.log(`  - Concluídos     : ${done}`);
  console.log(`  - Pendentes      : ${pending}`);
  console.log(`  - Palavras trans.: ${words}`);

  alert(
    `Progresso da Reunião\n\n` +
    `Tópicos: ${done} de ${total} concluídos\n` +
    `Palavras transcritas: ${words}\n\n` +
    `(Análise por IA será adicionada na Fase 2)`
  );
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

  const words = fullTranscript.trim().split(/\s+/).filter(Boolean).length;
  console.log('[APP] Reunião finalizada.');
  console.log(`[APP] Transcrição final (${words} palavras):`, fullTranscript);
});

// ===== UTIL =====
function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}
