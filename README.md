# Golazo 3D

Juego de fútbol 7 en 3D hecho con [three.js](https://threejs.org/), sin herramientas de compilación y sin recursos descargados: el estadio, el balón, las texturas y los sonidos se generan por código.

## Cómo jugar

Los módulos ES necesitan un servidor local (abrir `index.html` como archivo no funciona):

```bash
python3 -m http.server 8000
# o bien
npx serve .
```

Abre `http://localhost:8000`.

| Acción | Teclado | Mando |
| --- | --- | --- |
| Mover | WASD / flechas | Stick izquierdo |
| Sprint | Shift | RB / RT |
| Pase raso · entrada (sin balón) | J | A |
| Tiro (mantén para cargar; W/S apunta al palo) · plancha (sin balón) | K / Espacio | B |
| Pase elevado, centro, pase al hueco | L | X |
| Cambiar de jugador | Q | LB |
| Cámara (TV, cercana, táctica) | V | Y |
| Pausa / sonido | P / M | Start |

En móvil aparecen un joystick y botones táctiles.

## Sistema del balón (`src/ball.js`)

- **Aerodinámica**: gravedad, arrastre cuadrático y **efecto Magnus**. El giro curva el balón (rosca), lo hunde (liftado) o lo sostiene (retroceso).
- **Botes con fricción real**: en cada contacto con el césped un impulso tangencial transfiere velocidad a giro y viceversa (esfera hueca, I = ⅔·m·r²). Un balón con retroceso "muerde" el césped y uno con liftado sale disparado.
- **Rodadura** con resistencia del césped y giro coherente con la velocidad.
- **Colisiones** con postes y travesaño (cilindros), **redes deformables** (malla de muelles amortiguados que se abomba y ondula) y vallas publicitarias.
- **Resolución de trayectorias**: pases, centros y tiros usan el mismo integrador para calcular el golpeo. Un tiro con rosca sale abierto y la propia física lo cierra hacia el objetivo. Los pases rasos llegan al compañero con la velocidad deseada y los globos caen donde corresponde.
- **Conducción**: el jugador empuja el balón con toques calculados para que ruede por delante de él. Los giros bruscos lo frenan con la suela.

## Lo demás

- Jugadores articulados con animación procedural: carrera según la velocidad, golpeo con carga y remate, cabezazo, entrada en plancha, estirada del portero, caídas y cuatro celebraciones distintas.
- IA por equipos: presión, cobertura, marcaje zonal, desmarques, evaluación de líneas de pase, decisión de tiro y porteros que leen la trayectoria, se estiran, atajan o despejan.
- Reglas: saques de banda, córners, saques de puerta, saque inicial y tiempo de partido.
- Repetición del gol a cámara lenta, confeti, afición animada en GPU que reacciona al juego, sonido sintetizado con Web Audio y minimapa.

## Estructura

```
index.html        Interfaz (menú, marcador, overlays, controles táctiles)
lib/              three.js r169 (licencia MIT)
src/config.js     Medidas del campo, equipos, dificultad, formación
src/ball.js       Física del balón y resolución de trayectorias
src/game.js       Partido: IA, posesión, acciones, reglas, gol, repetición
src/player.js     Modelo del jugador y animación procedural
src/stadium.js    Césped, porterías, redes, gradas, público y luces
src/textures.js   Texturas generadas en canvas (balón, césped, red…)
src/effects.js    Partículas, estela del balón y ondas de impacto
src/camera.js     Cámara de retransmisión
src/audio.js      Sonido sintetizado
src/input.js      Teclado, mando y táctil
src/hud.js        Marcador, mensajes, minimapa y barra de potencia
src/replay.js     Grabación y reproducción de jugadas
```
