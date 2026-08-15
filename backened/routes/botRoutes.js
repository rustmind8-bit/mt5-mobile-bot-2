const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const metaApiService = require('../services/metaApiService');
const riskManager = require('../services/riskManager');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const PANEL_USERNAME = process.env.PANEL_USERNAME;
const PANEL_PASSWORD_HASH = process.env.PANEL_PASSWORD_HASH;

if (!JWT_SECRET || !PANEL_USERNAME || !PANEL_PASSWORD_HASH) {
  console.warn('[botRoutes] JWT_SECRET, PANEL_USERNAME ou PANEL_PASSWORD_HASH em falta no .env');
}

const botState = {
  botLigado: false,
  alertas: [],
  config: {
    lote: 0.01,
    dailyStopLossValor: 50,
    spreadMaximoPontos: 30,
  },
  saldoInicioDoDia: null,
  ultimoResetDia: null,
};

function adicionarAlerta(mensagem) {
  botState.alertas.unshift({ mensagem, timestamp: new Date().toISOString() });
  botState.alertas = botState.alertas.slice(0, 20);
}

function garantirResetDiario(saldoAtual) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (botState.ultimoResetDia !== hoje) {
    botState.ultimoResetDia = hoje;
    botState.saldoInicioDoDia = saldoAtual;
  }
}

function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: 'Token em falta.' });
  }
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Token invalido ou expirado.' });
  }
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ erro: 'Utilizador e senha sao obrigatorios.' });
  }

  const utilizadorValido = username === PANEL_USERNAME;
  const senhaValida = utilizadorValido && (await bcrypt.compare(password, PANEL_PASSWORD_HASH));

  if (!utilizadorValido || !senhaValida) {
    return res.status(401).json({ erro: 'Credenciais invalidas.' });
  }

  const token = jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

router.use('/bot', autenticar);

router.get('/bot/status', async (req, res) => {
  try {
    const conta = await metaApiService.obterEstadoDaConta();
    garantirResetDiario(conta.balance);

    res.json({
      conta: {
        balance: conta.balance,
        equity: conta.equity,
        currency: conta.currency,
        floatingPnL: conta.floatingPnL,
        openPositions: conta.openPositions,
        connected: conta.connected,
      },
      bot: {
        botLigado: botState.botLigado,
        travaDeSeguranca: riskManager.estaTravado(),
        alertas: botState.alertas,
      },
    });
  } catch (err) {
    console.error('[status]', err.message);
    res.status(502).json({ erro: 'Nao foi possivel obter dados da MetaApi.' });
  }
});

router.post('/bot/ligar', async (req, res) => {
  if (riskManager.estaTravado()) {
    return res.status(423).json({ erro: 'Trava de seguranca ativa. Nao e possivel ligar o bot agora.' });
  }
  botState.botLigado = true;
  adicionarAlerta('Bot ligado.');
  res.json({ botLigado: true });
});

router.post('/bot/desligar', (req, res) => {
  botState.botLigado = false;
  adicionarAlerta('Bot desligado.');
  res.json({ botLigado: false });
});

router.post('/bot/config', (req, res) => {
  const { lote, dailyStopLossValor, spreadMaximoPontos } = req.body || {};

  if (lote !== undefined) botState.config.lote = Number(lote);
  if (dailyStopLossValor !== undefined) botState.config.dailyStopLossValor = Number(dailyStopLossValor);
  if (spreadMaximoPontos !== undefined) botState.config.spreadMaximoPontos = Number(spreadMaximoPontos);

  adicionarAlerta('Configuracao atualizada.');
  res.json({ config: botState.config });
});

router.post('/bot/fechar-tudo', async (req, res) => {
  try {
    const resultados = await metaApiService.fecharTodasAsPosicoes();
    botState.botLigado = false;
    adicionarAlerta(`Fecho de emergencia: ${resultados.length} posicao(oes) processada(s).`);
    res.json({ resultados });
  } catch (err) {
    console.error('[fechar-tudo]', err.message);
    res.status(502).json({ erro: 'Falha ao fechar posicoes na MetaApi.' });
  }
});

module.exports = router;
