// Importa o Express para criar o servidor e as rotas da API
const express = require("express");
const crypto = require("crypto");
const client = require("prom-client");

// Importa a biblioteca usada para comunicação com o RabbitMQ
const amqp = require("amqplib");

// Carrega as configurações do arquivo .env
require("dotenv").config();

// Importa o Mongoose para conectar o Node.js ao MongoDB
const mongoose = require("mongoose");

// Cria a aplicação usando o Express
const app = express();

// Define a porta do Execution Service
const porta = 3002;

// Permite que a API receba dados em formato JSON
app.use(express.json());

// Registro Prometheus exclusivo do microsservico
const metricsRegistry = new client.Registry();

client.collectDefaultMetrics({
  register: metricsRegistry,
  prefix: "execution_service_"
});

const httpRequestsTotal = new client.Counter({
  name: "execution_service_http_requests_total",
  help: "Total de requisicoes HTTP",
  labelNames: [
    "method",
    "route",
    "status_code"
  ],
  registers: [metricsRegistry]
});

const httpRequestDuration =
  new client.Histogram({
    name:
      "execution_service_http_request_duration_seconds",
    help:
      "Duracao das requisicoes HTTP em segundos",
    labelNames: [
      "method",
      "route",
      "status_code"
    ],
    buckets: [
      0.01,
      0.05,
      0.1,
      0.3,
      0.5,
      1,
      2,
      5
    ],
    registers: [metricsRegistry]
  });

// Correlacao, medicao e logs estruturados
app.use((req, res, next) => {
  const correlationId =
    req.get("X-Correlation-ID") ||
    crypto.randomUUID();

  req.correlationId = correlationId;

  res.set(
    "X-Correlation-ID",
    correlationId
  );

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const seconds =
      Number(
        process.hrtime.bigint() - start
      ) / 1_000_000_000;

    const route =
      req.route?.path ||
      req.path ||
      "unknown";

    const labels = {
      method: req.method,
      route,
      status_code: String(
        res.statusCode
      )
    };

    httpRequestsTotal.inc(labels);

    httpRequestDuration.observe(
      labels,
      seconds
    );

    console.log(
      JSON.stringify({
        timestamp:
          new Date().toISOString(),
        level: "info",
        service:
          "execution_service",
        correlation_id:
          correlationId,
        method: req.method,
        route,
        status_code:
          res.statusCode,
        duration_ms:
          Number(
            (seconds * 1000).toFixed(2)
          )
      })
    );
  });

  next();
});

// Metricas no formato Prometheus
app.get("/metrics", async (req, res) => {
  res.set(
    "Content-Type",
    metricsRegistry.contentType
  );

  res.end(
    await metricsRegistry.metrics()
  );
});

// Canal compartilhado para consumir e publicar mensagens no RabbitMQ
let canalRabbitMQ;

// Permite fornecer um canal RabbitMQ simulado durante os testes
function definirCanalRabbitMQ(canal) {
  canalRabbitMQ = canal;
}

// Conecta o Execution Service ao RabbitMQ
async function conectarRabbitMQ() {
  try {
    const conexao = await amqp.connect(process.env.RABBITMQ_URL);
    canalRabbitMQ = await conexao.createChannel();

    // Garante que a fila exista
    await canalRabbitMQ.assertQueue("pagamento_confirmado", {
      durable: true
    });
    // Cria a fila usada para avisar que uma execução falhou
    await canalRabbitMQ.assertQueue("execucao_falhou", {
    durable: true
    });

    console.log("Execution Service conectado ao RabbitMQ!");

    // Fica aguardando mensagens na fila
    canalRabbitMQ.consume("pagamento_confirmado", (msg) => {
      if (msg) {
        const mensagem = JSON.parse(msg.content.toString());

        console.log("Mensagem recebida do RabbitMQ:");
        console.log(mensagem);

        // Confirma ao RabbitMQ que a mensagem foi processada
        canalRabbitMQ.ack(msg);
      }
    });

  } catch (erro) {
    console.error(
      "Erro ao conectar Execution Service ao RabbitMQ:",
      erro.message
    );
  }
}

// Nos testes automatizados, não conecta ao RabbitMQ real
if (process.env.NODE_ENV !== "test") {
  conectarRabbitMQ();
}

// Conecta o Execution Service ao MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Conexão com o MongoDB realizada com sucesso!");
  })
  .catch((erro) => {
    console.error("Erro ao conectar com o MongoDB:", erro.message);
  });

// Define a estrutura dos dados de execução
const execucaoSchema = new mongoose.Schema({
  ordem_id: {
    type: Number,
    required: true
  },
  diagnostico: {
    type: String,
    required: true
  },
  reparo: {
    type: String,
    required: true
  },
  status: {
    type: String,
    default: "AGUARDANDO_EXECUCAO"
  }
}, {
  timestamps: true
});

// Cria o modelo usado para salvar e consultar execuções
const Execucao = mongoose.model("Execucao", execucaoSchema);

// Rota usada para verificar se o Execution Service está funcionando
app.get("/", (req, res) => {
  res.json({
    mensagem: "Execution Service está funcionando!"
  });
});

// Rota que cria uma nova execução
app.post("/execucoes", async (req, res) => {
  const { ordem_id, diagnostico, reparo } = req.body;

  // Verifica se os campos obrigatórios foram enviados
  if (!ordem_id || !diagnostico || !reparo) {
    return res.status(400).json({
      mensagem: "Ordem, diagnóstico e reparo são obrigatórios"
    });
  }

  try {
    // Consulta o Billing Service para verificar se a ordem possui pagamento confirmado
    const respostaBilling = await fetch(
      `${process.env.BILLING_SERVICE_URL}/pagamentos/ordem/${ordem_id}/confirmado`
    );

    // Se não existir pagamento confirmado, não permite criar a execução
    if (respostaBilling.status === 404) {
      return res.status(400).json({
        mensagem: "Não é possível iniciar a execução: pagamento não confirmado"
      });
    }

    // Se houver outro problema ao consultar o Billing Service
    if (!respostaBilling.ok) {
      return res.status(502).json({
        mensagem: "Erro ao consultar o Billing Service"
      });
    }
    // Monta e salva uma nova execução no MongoDB
    const novaExecucao = await Execucao.create({
      ordem_id,
      diagnostico,
      reparo
    });

    res.status(201).json(novaExecucao);
  } catch (erro) {
    console.error("Erro ao criar execução:", erro.message);

    res.status(500).json({
      mensagem: "Erro interno ao criar execução"
    });
  }
});

// Rota que lista todas as execuções
app.get("/execucoes", async (req, res) => {
  try {
    const execucoes = await Execucao.find();

    res.json(execucoes);
  } catch (erro) {
    console.error("Erro ao listar execuções:", erro.message);

    res.status(500).json({
      mensagem: "Erro interno ao listar execuções"
    });
  }
});

// Rota que busca uma execução específica pelo ID do MongoDB
app.get("/execucoes/:id", async (req, res) => {
  const id = req.params.id;

  // Verifica se o ID possui um formato válido do MongoDB
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      mensagem: "ID de execução inválido"
    });
  }

  try {
    // Busca a execução pelo ID
    const execucao = await Execucao.findById(id);

    // Verifica se a execução existe
    if (!execucao) {
      return res.status(404).json({
        mensagem: "Execução não encontrada"
      });
    }

    // Devolve a execução encontrada
    res.json(execucao);
  } catch (erro) {
    console.error("Erro ao buscar execução:", erro.message);

    res.status(500).json({
      mensagem: "Erro interno ao buscar execução"
    });
  }
});

// Rota que atualiza o status de uma execução
app.patch("/execucoes/:id/status", async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  // Verifica se o ID possui um formato válido do MongoDB
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      mensagem: "ID de execução inválido"
    });
  }

  // Verifica se um status foi enviado
  if (!status) {
    return res.status(400).json({
      mensagem: "O novo status é obrigatório"
    });
  }

  // Define os status permitidos para a execução
  const statusPermitidos = [
    "AGUARDANDO_EXECUCAO",
    "EM_DIAGNOSTICO",
    "EM_REPARO",
    "CONCLUIDA",
    "CANCELADA"
  ];

  // Recusa um status que não esteja na lista
  if (!statusPermitidos.includes(status)) {
    return res.status(400).json({
      mensagem: "Status inválido",
      statusPermitidos
    });
  }

  try {
    // Busca a execução pelo ID e atualiza o status
    const execucaoAtualizada = await Execucao.findByIdAndUpdate(
      id,
      { status },
      {
        new: true,
        runValidators: true
      }
    );

    // Verifica se a execução existe
    if (!execucaoAtualizada) {
      return res.status(404).json({
        mensagem: "Execução não encontrada"
      });
    }

    // Se o reparo terminou, informa o OS Service
    if (status === "CONCLUIDA") {
      const respostaOS = await fetch(
        `${process.env.OS_SERVICE_URL}/ordens/${execucaoAtualizada.ordem_id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            status: "FINALIZADA"
          })
        }
      );

      // Verifica se o OS Service conseguiu finalizar a ordem
      if (!respostaOS.ok) {
        return res.status(502).json({
          mensagem: "Execução concluída, mas houve erro ao finalizar a ordem no OS Service"
        });
      }
    }

    // Devolve a execução atualizada
    res.json(execucaoAtualizada);

  } catch (erro) {
    console.error("Erro ao atualizar execução:", erro.message);

    res.status(500).json({
      mensagem: "Erro interno ao atualizar execução"
    });
  }
});

// Rota usada para simular uma falha de execução
app.post("/execucoes/:id/falhar", async (req, res) => {
  const id = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      mensagem: "ID de execução inválido"
    });
  }

  try {
    // Marca a execução como cancelada
    const execucao = await Execucao.findByIdAndUpdate(
      id,
      { status: "CANCELADA" },
      { new: true }
    );

    if (!execucao) {
      return res.status(404).json({
        mensagem: "Execução não encontrada"
      });
    }

    // Monta a mensagem de falha
    const mensagem = {
      tipo: "EXECUCAO_FALHOU",
      execucao_id: execucao._id.toString(),
      ordem_id: execucao.ordem_id
    };

    // Envia a mensagem para o RabbitMQ
    canalRabbitMQ.sendToQueue(
      "execucao_falhou",
      Buffer.from(JSON.stringify(mensagem)),
      { persistent: true }
    );

    console.log("Mensagem EXECUCAO_FALHOU enviada para o RabbitMQ");

// Avisa o OS Service que a ordem também deve ser cancelada
const respostaOS = await fetch(
  `${process.env.OS_SERVICE_URL}/ordens/${execucao.ordem_id}/status`,
  {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      status: "CANCELADA"
    })
  }
);

// Verifica se o OS Service conseguiu cancelar a ordem
if (!respostaOS.ok) {
  return res.status(502).json({
    mensagem: "Falha registrada, mas houve erro ao cancelar a ordem no OS Service"
  });
}

    res.json({
      mensagem: "Falha de execução registrada",
      execucao
    });

  } catch (erro) {
    console.error("Erro ao registrar falha:", erro.message);

    res.status(500).json({
      mensagem: "Erro interno ao registrar falha da execução"
    });
  }
});

// Só inicia o servidor quando executamos node index.js diretamente
if (require.main === module) {
  app.listen(porta, () => {
    console.log(`Execution Service iniciado na porta ${porta}`);
  });
}

// Permite que os testes importem a API, o MongoDB e o modelo Execucao
module.exports = {
  app,
  mongoose,
  Execucao,
  definirCanalRabbitMQ
};