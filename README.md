# FarmDogs

**Servidores, seeding, equipo y VIP de Wardogs en una aplicación para Windows.**

FarmDogs reúne los cinco servidores de Wardogs Spain, un selector automático de equipo y movimiento temporal anti-AFK. Funciona en tu PC y guarda allí su configuración. Es un proyecto independiente, sin afiliación con Wardogs ni Wardogs Spain.

[Descargar el portable](https://github.com/wasonidas/FarmDogs/releases/latest) · [Ver las versiones](https://github.com/wasonidas/FarmDogs/releases) · [Licencia MIT](LICENSE)

## Descargar y abrir

Para usar FarmDogs no necesitas compilar ni instalar Node.js.

1. Abre la [última versión](https://github.com/wasonidas/FarmDogs/releases/latest) y descarga **FarmDogs-portable.zip** en sus archivos adjuntos.
2. Extrae **toda la carpeta** en una ubicación donde puedas guardar archivos.
3. Abre **FarmDogs.exe**.

Conserva las carpetas `bin`, `src` y `public` junto al ejecutable. El ZIP incluye Node.js; **FarmDogs.exe es el lanzador de la carpeta completa**, no un ejecutable independiente.

Necesitas Windows 10/11 x64, el runtime Microsoft Edge WebView2, reconocimiento OCR de Windows disponible para tus idiomas y Steam/Wardogs instalados. El lector aprovecha también el reconocedor en inglés cuando está instalado. El archivo **Source code** que GitHub genera en cada versión contiene las fuentes; para jugar con la aplicación ya compilada descarga **FarmDogs-portable.zip**.

### Actualizar sin perder tus ajustes

Cierra FarmDogs antes de actualizar. Extrae la versión nueva en otra carpeta, conserva una copia de tu carpeta `data` y pásala a la carpeta nueva antes de abrirla. Ahí se guardan los ajustes y el perfil de cuenta. No compartas esa carpeta con el clan: cada persona debe utilizar sus propios datos.

## Qué puedes hacer

| Función | Para qué sirve | ¿Requiere conectar Steam a FarmDogs? |
| --- | --- | --- |
| **Anti-AFK** | Movimiento temporal para una ausencia breve en tu partida actual. | No |
| **Entrar** | Ver población, elegir servidor y abrir Wardogs con su ID preparado. | No |
| **Seedear** | Preparar una sesión ahora, a una hora o al detectar actividad. | Para comprobar presencia privada; existe confirmación manual |
| **Elegir equipo** | Intentar entrar automáticamente en azul, rojo o verde. | No |
| **Mi VIP** | Consultar cuenta, progreso y premios pendientes. | Sí |

**Anti-AFK** permanece visible encima de las cuatro pestañas. La conexión de Steam mencionada en la tabla es la de la cuenta web de FarmDogs; el juego sigue utilizando tu sesión normal de Steam.

## Anti-AFK para una pausa

Puedes usarlo dentro de cualquier servidor de Wardogs, sin esperar población y sin elegir un servidor en la aplicación.

1. Estando desplegado, deja las **manos vacías**, los menús cerrados y espacio a ambos lados del personaje.
2. Elige **5, 15 o 30 minutos**, o escribe tu propia duración.
3. Marca **Estoy desplegado y con las manos vacías** y pulsa **Activar anti-AFK**.
4. Vuelve a Wardogs y déjalo en primer plano.

FarmDogs espera a reconocer la interfaz del personaje desplegado y alterna pasos a izquierda y derecha. En **Configurar movimiento** puedes ajustar:

| Ajuste | Valor inicial | Rango |
| --- | --- | --- |
| Duración máxima | 15 minutos | 1–720 minutos |
| Tiempo entre pasos | 30 segundos | 5–300 segundos |
| Duración de cada paso | 500 ms | 100–2000 ms |

**Detener** o **F8** cancelan la sesión. También termina al agotarse el tiempo elegido. Si abres un menú, pierdes el foco o deja de reconocerse el personaje, los pasos se pausan; solo reanudan con una captura válida nueva. El tiempo sigue contando durante las pausas. Una sesión cancelada no vuelve a arrancar sola.

Este modo no abre el juego, redespliega ni reconecta al personaje. Tampoco comprueba seeding ni concede por sí mismo días VIP.

## Elegir equipo automáticamente

1. Abre **Elegir equipo**, selecciona **azul, rojo o verde** y pulsa **Esperar equipo**.
2. Entra al servidor desde Wardogs y deja el juego delante.
3. Cuando aparezca el selector de facciones, FarmDogs reconocerá la tarjeta elegida y empezará a clicar.
4. Al leer **DESPLEGANDO**, se desactiva por completo.

No necesitas teclas de inicio, colocar el cursor ni guardar coordenadas. El intervalo entre clics se puede ajustar entre **20 y 2000 ms**.

Una vez reconocida la tarjeta, el clic continúa aunque el color se apague por equilibrio de equipos o desaparezca el selector. **ENTRANDO**, un cambio de color o la aparición del HUD no sustituyen la confirmación **DESPLEGANDO**.

Antes de adquirir la tarjeta puedes alternar entre FarmDogs y el juego. Una vez clicando, perder el foco, cambiar la ventana o su tamaño, pulsar una tecla modificadora o un error cancela el intento. Para repetir, pulsa **Esperar equipo** otra vez. **Cancelar** y **F8** también terminan la espera o los clics.

Cambiar color o velocidad durante la espera la cancela antes de aplicar los nuevos ajustes. El selector y el movimiento se excluyen: después de entrar al equipo y desarmarse el autoclic puedes activar anti-AFK o preparar seeding.

## Entrar y seedear

### Elegir un servidor

En **Entrar** verás los cinco servidores de Wardogs Spain y su población, consultada cada 30 segundos. El botón de apertura solicita iniciar Wardogs y copia el ID del servidor. Si falla el portapapeles, el juego se abre igualmente y el ID queda visible para copiarlo manualmente.

La entrada por ID, la elección de despliegue y la comprobación del destino dentro del juego siguen siendo asistidas. Abrir Wardogs no confirma que hayas entrado al servidor.

### Preparar una sesión de seeding

Elige servidor, duración y cómo comenzar:

- **Ahora:** prepara la sesión en ese momento.
- **A una hora:** programa fecha y hora de Madrid.
- **Al haber actividad:** observa la API pública y elige un destino que esté empezando a llenarse. Por defecto busca entre 1 y 19 jugadores y exige dos lecturas válidas.

El movimiento de seeding espera el umbral configurado —**20 jugadores por defecto**—, presencia confirmada y una captura reciente del personaje desplegado. El umbral de movimiento no determina la regla del premio VIP.

Con Steam conectado a FarmDogs, la cuenta verifica presencia privada. Si ya estás desplegado, puedes confirmar manualmente el mismo servidor para utilizar movimiento sin esa lectura. La confirmación manual no comprueba progreso ni premios.

Si se cierran nuevas admisiones, pero la cuenta y el servidor siguen confirmando tu ciclo, aparece **Continuar seeding**. La sesión puede continuar sin abrir otra vez el juego.

La duración incluye las esperas. Las programaciones necesitan el PC despierto y la aplicación abierta; se interrumpen al reiniciar y no ejecutan una hora perdida por más de un minuto. La búsqueda por actividad no lee mensajes de Discord ni acredita las ventajas de responder a una llamada del staff.

## Avisos grandes y sonido

FarmDogs avisa cuando una acción necesita **Wardogs en primer plano**. La ventana de aviso es grande, funciona con FarmDogs minimizada y no cambia la ventana activa. Se oculta al volver al juego. Distingue falta de foco de una pantalla o un HUD que no se reconoce.

Si la selección de equipo se cancela por perder el foco, el aviso explica que debes reactivar **Esperar equipo**.

- **Avisos con sonido:** activa o silencia el sonido de FarmDogs.
- **Probar aviso:** presenta un ejemplo de tres segundos.

Los avisos automáticos se deduplican y tienen un intervalo mínimo entre sonidos. No cambian el volumen del juego. Para recibir el aviso fuera del navegador, utiliza **FarmDogs.exe**.

## Mi VIP y la cuenta de Steam

Conecta Steam desde **Mi VIP** para consultar estado VIP, progreso y premios. El inicio de sesión se realiza en la web oficial dentro del perfil WebView2 de la aplicación. No necesitas una clave API de Steam ni copiar cookies desde otro navegador.

La protección **Cobrar antes de caducar** espera a que Wardogs publique la **fecha final de cobro** y actúa con la antelación guardada, 15 minutos por defecto. No cobra el premio de la semana en curso solo por activarla. Necesita el PC y FarmDogs abiertos y una lectura autorizada de la cuenta. Un resultado incierto no se repite automáticamente.

FarmDogs no gasta WSP ni compra VIP. Las reglas del servidor pueden cambiar; la población o un VIP histórico no prueban un premio nuevo. La información oficial está en [Wardogs Spain](https://wardogsspain.com/vip).

## Si algo no empieza

| Situación | Qué revisar |
| --- | --- |
| Anti-AFK espera o se pausa | Wardogs delante, personaje desplegado, manos vacías y menús cerrados. |
| Seeding espera población | Revisa el umbral de seeding. Para una pausa en una partida, usa el acceso Anti-AFK independiente. |
| Selector esperando | Debe verse el selector de facciones dentro de Wardogs. |
| Selector detenido al cambiar de ventana | Vuelve a pulsar Esperar equipo y regresa al juego. |
| Un botón está bloqueado | Detén el otro automatismo: movimiento, selector y programación no se ejecutan a la vez. |
| No se oye el aviso | Comprueba Avisos con sonido y Probar aviso; usa la ventana de escritorio. |
| No aparece VIP o progreso reciente | Revisa la conexión de la cuenta en Mi VIP. |

Si la aplicación muestra un error persistente, puedes [abrir una incidencia](https://github.com/wasonidas/FarmDogs/issues). Describe qué estabas haciendo y tu versión; evita adjuntar tu carpeta `data` o lecturas privadas de la cuenta.

## Privacidad y funcionamiento local

La configuración, el perfil de cuenta y los registros se guardan en `data`, junto a la aplicación. Esa carpeta está excluida del repositorio y del ZIP distribuido. Cada instalación crea sus propios datos; los paquetes publicados no incluyen sesiones, cookies, cuentas ni capturas personales.

El servicio local escucha en `127.0.0.1:24243`. FarmDogs consulta las fuentes de Wardogs Spain para población y, con tu sesión autorizada, cuenta y premios. Los componentes nativos reconocen elementos visuales y envían pulsaciones y clics normales; no modifican el juego ni leen su memoria.

## Estado de la versión

La versión **0.3.0** supera **278 pruebas Node**, **253 comprobaciones nativas del selector**, **41 de avisos de foco** y **19 de origen del host de escritorio**. Las pruebas automatizadas utilizan datos y entradas simuladas. El selector tiene además confirmación de uso real por su usuario inicial y el movimiento A/D se ha comprobado visualmente.

Siguen pendientes una prueba instrumentada prolongada durante partida activa y cambios de ronda, y la verificación de un premio VIP nuevo de un ciclo completo. No hay entrada autónoma por ID, redespliegue ni reconexión automática. La aplicación no garantiza evitar cualquier expulsión ni obtener VIP.

## Compilar desde el código

### Requisitos de desarrollo

- **Windows x64** y **Node.js 24 o posterior**, con npm.
- El compilador `csc.exe` de .NET Framework de 64 bits y los metadatos WinRT/OCR de Windows. Los scripts usan las rutas estándar del sistema.
- Microsoft Edge WebView2 Runtime para ejecutar la interfaz.
- Conexión a Internet para obtener el SDK WebView2 fijado y verificar su hash en la primera compilación.

El empaquetado copia el runtime Node que ejecuta el script y exige su archivo **LICENSE** completo junto a `node.exe`. La distribución ZIP oficial de Node para Windows incluye ese archivo. No hace falta instalar dependencias npm adicionales: el proyecto utiliza módulos incluidos en Node y bibliotecas de Windows.

```powershell
git clone https://github.com/wasonidas/FarmDogs.git
cd FarmDogs

npm test
npm run build:movement
npm run build:reader
npm run build:team-clicker
npm run build:desktop
npm run build:launcher
npm run package:portable
```

El resultado portable se crea en `dist`, con una lista explícita de archivos y un manifiesto SHA-256. Para abrir el host compilado puedes ejecutar `FarmDogs.exe` o `npm run desktop`. `npm start` inicia solo el servicio local; no abre la ventana de escritorio.

### Organización del código

| Directorio | Contenido |
| --- | --- |
| `src` | Servicio HTTP local, sesiones, reglas, lectura y coordinación. |
| `native` | Host WebView2, controlador de movimiento, selector, OCR y avisos de Windows. |
| `public` | Interfaz, ajustes y mensajes para el usuario. |
| `test` | Pruebas de lógica, API e interfaz y fixtures de prueba. |
| `tools` | Compilación, pruebas nativas y generación del portable. |

Los binarios generados, datos locales y paquetes no forman parte de las fuentes. Las contribuciones pueden enviarse mediante incidencias o pull requests.

## Licencia

El código propio de FarmDogs se distribuye bajo la [licencia MIT](LICENSE). Node.js y WebView2 conservan sus propias licencias: el portable incluye la de Node en `bin/runtime/LICENSE` y las de WebView2 en `licenses`.
