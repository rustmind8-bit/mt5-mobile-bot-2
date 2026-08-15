const MetaApi = require('metaapi.cloud-sdk').default;
const riskManager = require('./riskManager');

const token = process.env.METAAPI_TOKEN;
const accountId = process.env.METAAPI_ACCOUNT_ID;

if (!token || !accountId) {
  console.warn('[metaApiService] METAAPI_TOKEN ou METAAPI_ACCOUNT_ID em falta no .env');
}

const api = new MetaApi(token);

let connectionPromise = null;

async function obterLigacao() {
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    const account = await api.metatraderAccountApi.getAccount(accountId);

    if (['UNDEPLOYED', 'UNDEPLOYING'].includes(account.state)) {
      await account.deploy();
    }
    await account.waitConnected();

    const connection = account.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized();

    return connection;
  })();

  try {
    return await connectionPromise;
  } catch (err) {
    connectionPromise = null;
    throw err;
  }
}

async function obterEstadoDaConta() {
  const connection = await obterLigacao();

  const [infoConta, posicoes] = await Promise.all([
    connection.getAccountInformation(),
    connection.getPositions(),
  ]);

  riskManager.registarSincronizacao();

  const floatingPnL = posicoes.reduce((soma, p) => soma + (p.profit || 0), 0);

  return {
    balance: infoConta.balance,
    equity: infoConta.equity,
    currency: infoConta.currency,
    floatingPnL,
    openPositions: posicoes.length,
    connected: true,
    posicoes,
  };
}

async function fecharTodasAsPosicoes() {
  const connection = await obterLigacao();
  const posicoes = await connection.getPositions();

  const resultados = [];
  for (const posicao of posicoes) {
    try {
      await connection.closePosition(posicao.id);
      resultados.push({ id: posicao.id, ok: true });
    } catch (err) {
      resultados.push({ id: posicao.id, ok: false, erro: err.message });
    }
  }

  riskManager.registarSincronizacao();
  return resultados;
}

module.exports = {
  obterLigacao,
  obterEstadoDaConta,
  fecharTodasAsPosicoes,
};
