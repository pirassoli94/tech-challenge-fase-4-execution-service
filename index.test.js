// Define que estamos no ambiente de testes
process.env.NODE_ENV = "test";

// Carrega as configurações exclusivas dos testes
require("dotenv").config({
  path: ".env.test",
  override: true,
  quiet: true
});

// Ferramenta usada para testar as rotas da API
const request = require("supertest");

// Importa a aplicação, o MongoDB, o modelo de execução
// e a função que permite usar um canal RabbitMQ simulado
const {
  app,
  mongoose,
  Execucao,
  definirCanalRabbitMQ
} = require("./index");

// Guarda o ID de uma execução criada durante os testes
let execucaoId;

// Canal RabbitMQ simulado
const canalRabbitMQMock = {
  sendToQueue: jest.fn()
};


// ======================================================
// PREPARAÇÃO DOS TESTES
// ======================================================

beforeAll(async () => {

  // Aguarda a conexão com o MongoDB
  await mongoose.connection.asPromise();

  // Limpa registros antigos do banco de testes
  await Execucao.deleteMany({});

  // Fornece o canal RabbitMQ simulado ao serviço
  definirCanalRabbitMQ(canalRabbitMQMock);
});


beforeEach(() => {

  // Limpa o histórico dos mocks
  jest.clearAllMocks();

  // Simula respostas positivas das APIs externas
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({
      confirmado: true
    })
  });
});


describe("Execution Service", () => {

  // ======================================================
  // ROTA PRINCIPAL
  // ======================================================

  test("GET / deve informar que o serviço está funcionando", async () => {

    const resposta = await request(app)
      .get("/");

    expect(resposta.status).toBe(200);

    expect(resposta.body).toEqual({
      mensagem: "Execution Service está funcionando!"
    });
  });


  // ======================================================
  // CRIAÇÃO DA EXECUÇÃO
  // ======================================================

  test("POST /execucoes deve criar uma execução", async () => {

    const resposta = await request(app)
      .post("/execucoes")
      .send({
        ordem_id: 10,
        diagnostico: "Diagnóstico automatizado",
        reparo: "Reparo automatizado"
      });

    expect(resposta.status).toBe(201);

    expect(resposta.body.ordem_id)
      .toBe(10);

    expect(resposta.body.diagnostico)
      .toBe("Diagnóstico automatizado");

    expect(resposta.body.reparo)
      .toBe("Reparo automatizado");

    expect(resposta.body.status)
      .toBe("AGUARDANDO_EXECUCAO");

    expect(resposta.body._id)
      .toBeDefined();

    execucaoId = resposta.body._id;
  });


  test("POST /execucoes deve exigir campos obrigatórios", async () => {

    const resposta = await request(app)
      .post("/execucoes")
      .send({
        ordem_id: 10
      });

    expect(resposta.status).toBe(400);

    expect(resposta.body.mensagem)
      .toBe(
        "Ordem, diagnóstico e reparo são obrigatórios"
      );
  });


  test("POST /execucoes deve bloquear pagamento não confirmado", async () => {

    global.fetch.mockResolvedValueOnce({
      status: 404,
      ok: false
    });

    const resposta = await request(app)
      .post("/execucoes")
      .send({
        ordem_id: 20,
        diagnostico: "Diagnóstico teste",
        reparo: "Reparo teste"
      });

    expect(resposta.status).toBe(400);

    expect(resposta.body.mensagem)
      .toBe(
        "Não é possível iniciar a execução: pagamento não confirmado"
      );
  });


  test("POST /execucoes deve retornar 502 quando o Billing Service falhar", async () => {

    global.fetch.mockResolvedValueOnce({
      status: 500,
      ok: false
    });

    const resposta = await request(app)
      .post("/execucoes")
      .send({
        ordem_id: 50,
        diagnostico: "Diagnóstico integração",
        reparo: "Reparo integração"
      });

    expect(resposta.status).toBe(502);

    expect(resposta.body.mensagem)
      .toBe("Erro ao consultar o Billing Service");
  });


  test("POST /execucoes deve retornar 500 quando o MongoDB falhar", async () => {

    jest.spyOn(Execucao, "create")
      .mockRejectedValueOnce(
        new Error("Falha simulada no MongoDB")
      );

    const resposta = await request(app)
      .post("/execucoes")
      .send({
        ordem_id: 51,
        diagnostico: "Diagnóstico MongoDB",
        reparo: "Reparo MongoDB"
      });

    expect(resposta.status).toBe(500);

    expect(resposta.body.mensagem)
      .toBe("Erro interno ao criar execução");
  });


  // ======================================================
  // LISTAGEM
  // ======================================================

  test("GET /execucoes deve listar execuções", async () => {

    const resposta = await request(app)
      .get("/execucoes");

    expect(resposta.status).toBe(200);

    expect(Array.isArray(resposta.body))
      .toBe(true);

    expect(resposta.body.length)
      .toBeGreaterThan(0);
  });


  test("GET /execucoes deve retornar 500 quando o MongoDB falhar", async () => {

    jest.spyOn(Execucao, "find")
      .mockRejectedValueOnce(
        new Error("Falha simulada na listagem")
      );

    const resposta = await request(app)
      .get("/execucoes");

    expect(resposta.status).toBe(500);

    expect(resposta.body.mensagem)
      .toBe("Erro interno ao listar execuções");
  });


  // ======================================================
  // BUSCA POR ID
  // ======================================================

  test("GET /execucoes/:id deve buscar uma execução", async () => {

    const resposta = await request(app)
      .get(`/execucoes/${execucaoId}`);

    expect(resposta.status).toBe(200);

    expect(resposta.body._id)
      .toBe(execucaoId);

    expect(resposta.body.ordem_id)
      .toBe(10);
  });


  test("GET /execucoes/:id deve rejeitar ID inválido", async () => {

    const resposta = await request(app)
      .get("/execucoes/id-invalido");

    expect(resposta.status).toBe(400);

    expect(resposta.body.mensagem)
      .toBe("ID de execução inválido");
  });


  test("GET /execucoes/:id deve retornar 404 para execução inexistente", async () => {

    const idInexistente =
      new mongoose.Types.ObjectId().toString();

    const resposta = await request(app)
      .get(`/execucoes/${idInexistente}`);

    expect(resposta.status).toBe(404);

    expect(resposta.body.mensagem)
      .toBe("Execução não encontrada");
  });


  test("GET /execucoes/:id deve retornar 500 quando o MongoDB falhar", async () => {

    const idValido =
      new mongoose.Types.ObjectId().toString();

    jest.spyOn(Execucao, "findById")
      .mockRejectedValueOnce(
        new Error("Falha simulada na busca")
      );

    const resposta = await request(app)
      .get(`/execucoes/${idValido}`);

    expect(resposta.status).toBe(500);

    expect(resposta.body.mensagem)
      .toBe("Erro interno ao buscar execução");
  });


  // ======================================================
  // ATUALIZAÇÃO DE STATUS
  // ======================================================

  test("PATCH deve atualizar para EM_DIAGNOSTICO", async () => {

    const resposta = await request(app)
      .patch(`/execucoes/${execucaoId}/status`)
      .send({
        status: "EM_DIAGNOSTICO"
      });

    expect(resposta.status).toBe(200);

    expect(resposta.body.status)
      .toBe("EM_DIAGNOSTICO");
  });


  test("PATCH deve atualizar para EM_REPARO", async () => {

    const resposta = await request(app)
      .patch(`/execucoes/${execucaoId}/status`)
      .send({
        status: "EM_REPARO"
      });

    expect(resposta.status).toBe(200);

    expect(resposta.body.status)
      .toBe("EM_REPARO");
  });


  test("PATCH deve rejeitar status inválido", async () => {

    const resposta = await request(app)
      .patch(`/execucoes/${execucaoId}/status`)
      .send({
        status: "STATUS_INVENTADO"
      });

    expect(resposta.status).toBe(400);

    expect(resposta.body.mensagem)
      .toBe("Status inválido");
  });


  test("PATCH deve exigir o status", async () => {

    const resposta = await request(app)
      .patch(`/execucoes/${execucaoId}/status`)
      .send({});

    expect(resposta.status).toBe(400);

    expect(resposta.body.mensagem)
      .toBe("O novo status é obrigatório");
  });


  test("PATCH deve rejeitar ID inválido", async () => {

    const resposta = await request(app)
      .patch("/execucoes/id-invalido/status")
      .send({
        status: "EM_REPARO"
      });

    expect(resposta.status).toBe(400);

    expect(resposta.body.mensagem)
      .toBe("ID de execução inválido");
  });


  test("PATCH deve retornar 404 para execução inexistente", async () => {

    const idInexistente =
      new mongoose.Types.ObjectId().toString();

    const resposta = await request(app)
      .patch(`/execucoes/${idInexistente}/status`)
      .send({
        status: "EM_REPARO"
      });

    expect(resposta.status).toBe(404);

    expect(resposta.body.mensagem)
      .toBe("Execução não encontrada");
  });


  test("PATCH CONCLUIDA deve avisar o OS Service", async () => {

    const resposta = await request(app)
      .patch(`/execucoes/${execucaoId}/status`)
      .send({
        status: "CONCLUIDA"
      });

    expect(resposta.status).toBe(200);

    expect(resposta.body.status)
      .toBe("CONCLUIDA");

    expect(global.fetch)
      .toHaveBeenCalledWith(
        "http://localhost:3000/ordens/10/status",
        expect.objectContaining({
          method: "PATCH"
        })
      );
  });


  test("PATCH CONCLUIDA deve retornar 502 quando o OS Service falhar", async () => {

    const execucao = await Execucao.create({
      ordem_id: 60,
      diagnostico: "Diagnóstico OS indisponível",
      reparo: "Reparo OS indisponível"
    });

    global.fetch.mockResolvedValueOnce({
      status: 500,
      ok: false
    });

    const resposta = await request(app)
      .patch(`/execucoes/${execucao._id}/status`)
      .send({
        status: "CONCLUIDA"
      });

    expect(resposta.status).toBe(502);

    expect(resposta.body.mensagem)
      .toBe(
        "Execução concluída, mas houve erro ao finalizar a ordem no OS Service"
      );
  });


  test("PATCH deve retornar 500 quando o MongoDB falhar", async () => {

    const idValido =
      new mongoose.Types.ObjectId().toString();

    jest.spyOn(Execucao, "findByIdAndUpdate")
      .mockRejectedValueOnce(
        new Error("Falha simulada na atualização")
      );

    const resposta = await request(app)
      .patch(`/execucoes/${idValido}/status`)
      .send({
        status: "EM_REPARO"
      });

    expect(resposta.status).toBe(500);

    expect(resposta.body.mensagem)
      .toBe("Erro interno ao atualizar execução");
  });


  // ======================================================
  // FALHA E COMPENSAÇÃO DA SAGA
  // ======================================================

  test("POST /execucoes/:id/falhar deve cancelar a execução e publicar o evento", async () => {

    const execucao = await Execucao.create({
      ordem_id: 30,
      diagnostico: "Diagnóstico da falha",
      reparo: "Reparo interrompido"
    });

    const resposta = await request(app)
      .post(`/execucoes/${execucao._id}/falhar`);

    expect(resposta.status).toBe(200);

    expect(resposta.body.mensagem)
      .toBe("Falha de execução registrada");

    expect(resposta.body.execucao.status)
      .toBe("CANCELADA");

    expect(canalRabbitMQMock.sendToQueue)
      .toHaveBeenCalledWith(
        "execucao_falhou",
        expect.any(Buffer),
        {
          persistent: true
        }
      );

    expect(global.fetch)
      .toHaveBeenCalledWith(
        "http://localhost:3000/ordens/30/status",
        expect.objectContaining({
          method: "PATCH"
        })
      );
  });


  test("POST /execucoes/:id/falhar deve publicar EXECUCAO_FALHOU com os dados corretos", async () => {

    const execucao = await Execucao.create({
      ordem_id: 31,
      diagnostico: "Diagnóstico do evento",
      reparo: "Reparo do evento"
    });

    const resposta = await request(app)
      .post(`/execucoes/${execucao._id}/falhar`);

    expect(resposta.status).toBe(200);

    expect(canalRabbitMQMock.sendToQueue)
      .toHaveBeenCalled();

    const bufferEnviado =
      canalRabbitMQMock.sendToQueue.mock.calls[0][1];

    const mensagemPublicada = JSON.parse(
      bufferEnviado.toString()
    );

    expect(mensagemPublicada.tipo)
      .toBe("EXECUCAO_FALHOU");

    expect(mensagemPublicada.ordem_id)
      .toBe(31);

    expect(mensagemPublicada.execucao_id)
      .toBe(execucao._id.toString());
  });


  test("POST /execucoes/:id/falhar deve rejeitar ID inválido", async () => {

    const resposta = await request(app)
      .post("/execucoes/id-invalido/falhar");

    expect(resposta.status).toBe(400);

    expect(resposta.body.mensagem)
      .toBe("ID de execução inválido");
  });


  test("POST /execucoes/:id/falhar deve retornar 404 para execução inexistente", async () => {

    const idInexistente =
      new mongoose.Types.ObjectId().toString();

    const resposta = await request(app)
      .post(`/execucoes/${idInexistente}/falhar`);

    expect(resposta.status).toBe(404);

    expect(resposta.body.mensagem)
      .toBe("Execução não encontrada");
  });


  test("POST /execucoes/:id/falhar deve informar erro quando o OS Service falhar", async () => {

    const execucao = await Execucao.create({
      ordem_id: 40,
      diagnostico: "Diagnóstico de erro",
      reparo: "Reparo de erro"
    });

    global.fetch.mockResolvedValueOnce({
      status: 500,
      ok: false
    });

    const resposta = await request(app)
      .post(`/execucoes/${execucao._id}/falhar`);

    expect(resposta.status).toBe(502);

    expect(resposta.body.mensagem)
      .toBe(
        "Falha registrada, mas houve erro ao cancelar a ordem no OS Service"
      );
  });


  test("POST falhar deve retornar 500 quando o MongoDB falhar", async () => {

    const idValido =
      new mongoose.Types.ObjectId().toString();

    jest.spyOn(Execucao, "findByIdAndUpdate")
      .mockRejectedValueOnce(
        new Error("Falha simulada durante cancelamento")
      );

    const resposta = await request(app)
      .post(`/execucoes/${idValido}/falhar`);

    expect(resposta.status).toBe(500);

    expect(resposta.body.mensagem)
      .toBe("Erro interno ao registrar falha da execução");
  });

});


// ======================================================
// FINALIZAÇÃO DOS TESTES
// ======================================================

afterAll(async () => {

  // Limpa o banco de testes
  await Execucao.deleteMany({});

  // Fecha a conexão com o MongoDB
  await mongoose.connection.close();
});