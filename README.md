# Execution Service — Tech Challenge FIAP Fase 4

## Visão geral
Microsserviço responsável pelo gerenciamento da execução dos serviços de manutenção e reparo dos veículos.

Tecnologias: Node.js, MongoDB, RabbitMQ, Docker e Kubernetes.

## Arquitetura
O Execution Service utiliza MongoDB como banco de dados independente.

A comunicação entre os microsserviços combina APIs REST e eventos assíncronos pelo RabbitMQ.

## Saga Pattern
O projeto utiliza uma abordagem híbrida, combinando comunicação HTTP e eventos assíncronos.

### Fluxo de sucesso
Após a confirmação do pagamento, o Execution Service recebe o evento PAGAMENTO_CONFIRMADO pelo RabbitMQ.

No fluxo validado, a execução é criada por uma chamada à API REST.

Quando a execução é marcada como CONCLUIDA, o serviço atualiza a ordem correspondente no OS Service para FINALIZADA.

### Fluxo de compensação
Quando ocorre uma falha na execução, o serviço registra a execução como CANCELADA.

A ordem de serviço correspondente é atualizada para CANCELADA e um evento de compensação é enviado pelo RabbitMQ.

O Billing Service registra o pagamento como CANCELAMENTO_PENDENTE. O estorno financeiro efetivo não faz parte do fluxo demonstrado.

## API
Porta padrão: 3002.

Operações utilizadas na integração:
- POST /execucoes — criar execução.
- PATCH /execucoes/:id/status — atualizar status.
- POST /execucoes/:id/falhar — registrar falha e iniciar compensação.

A collection Postman está disponível no diretório postman/.

## Execução local
Instalar dependências: npm ci

Executar testes: npm run test:coverage

Iniciar aplicação: node index.js

## Docker
Construir imagem: docker build -t execution-service:1.0 .

## Kubernetes
Os manifestos de implantação estão disponíveis no diretório k8s/.

O serviço foi validado em um cluster Kubernetes local utilizando Docker Desktop.

## Testes e qualidade
O serviço possui testes automatizados e verificação de cobertura mínima de 80%.

A análise de qualidade utiliza SonarQube Cloud.

A evidência de cobertura está disponível no arquivo cobertura-execution.txt.

O cenário BDD de compensação da Saga está no diretório bdd-tests, localizado na pasta principal do projeto.

## CI/CD
O workflow .github/workflows/ci-cd.yml contempla testes automatizados, análise de qualidade, build Docker e um job de deploy Kubernetes.

A execução efetiva do deploy depende da configuração do ambiente e das credenciais necessárias.

## Observabilidade
O serviço disponibiliza métricas pela rota GET /metrics e utiliza logs estruturados para acompanhamento dos eventos e das execuções.

## Segurança
Credenciais, tokens, arquivos de ambiente e dependências instaladas não devem ser publicados no repositório.
