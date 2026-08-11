import { validateHostedDatabaseConfiguration } from "../src/db/runtime-config";

const configuration = validateHostedDatabaseConfiguration();

if (configuration) {
  console.log(
    JSON.stringify({
      check: "hosted-database-configuration",
      status: "valid",
      environment: configuration.environment,
      host_kind: configuration.hostKind,
      port: configuration.port,
      max_connections: configuration.maxConnections,
      secrets_reported: 0,
    }),
  );
}
