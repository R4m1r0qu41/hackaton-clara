'use strict';

const { cargarConfig } = require('./config');
const { crearServidor } = require('./app');

const config = cargarConfig();
const servidor = crearServidor(config);

servidor.listen(config.puerto, config.host, () => {
  console.log(`Servidor en http://${config.host}:${config.puerto} (modo ejemplo: respuestas no reales)`);
  if (!config.botApiKey) {
    console.log('Aviso: BOT_API_KEY no está definida, así que /api/procesar y /api/elegir-respuesta no piden clave.');
  }
});
