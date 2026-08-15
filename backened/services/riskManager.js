const LIMITE_SEM_SYNC_MS = 30 * 1000;

let ultimaSincronizacao = Date.now();

function registarSincronizacao() {
  ultimaSincronizacao = Date.now();
}

function estaTravado() {
  return Date.now() - ultimaSincronizacao > LIMITE_SEM_SYNC_MS;
}

function segundosDesdeUltimaSync() {
  return Math.round((Date.now() - ultimaSincronizacao) / 1000);
}

function verificarLimitesDeRisco({ config, saldoInicioDoDia, saldoAtual, floatingPnL, spreadAtualPontos }) {
  if (estaTravado()) {
    return { permitido: false, motivo: 'Trava de seguranca ativa (sem sincronizacao com a MetaApi).' };
  }

  if (config.dailyStopLossValor) {
    const perdaDoDia = saldoInicioDoDia - (saldoAtual + floatingPnL);
    if (perdaDoDia >= config.dailyStopLossValor) {
      return { permitido: false, motivo: 'Limite de perda diaria atingido.' };
    }
  }

  if (config.spreadMaximoPontos && spreadAtualPontos && spreadAtualPontos > config.spreadMaximoPontos) {
    return { permitido: false, motivo: `Spread acima do limite (${spreadAtualPontos}pts).` };
  }

  return { permitido: true };
}

module.exports = {
  registarSincronizacao,
  estaTravado,
  segundosDesdeUltimaSync,
  verificarLimitesDeRisco,
};
