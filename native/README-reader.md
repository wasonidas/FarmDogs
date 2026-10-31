# Lector de imágenes y pantallas

Componente de desarrollo de solo lectura: `ImageTextReader.cs` y `GameFrameCapture.cs`. Usa WinRT OCR y bibliotecas de Windows/.NET ya instaladas. No envía entradas, activa ventanas, instala idiomas ni cambia políticas de ejecución.

Compilación: `npm run build:reader`.

`bin/WardogsImageText.exe imagen salida.json` analiza un archivo de hasta 20 MB. La salida conserva hash, idioma, tamaño y palabras con sus coordenadas. No escala imágenes implícitamente y rechaza una salida que coincida con la imagen. `capturedAt` queda nulo para archivos: su fecha de modificación o análisis no acredita una captura nueva.

`bin/WardogsImageText.exe --foreground-game salida.json` intenta una captura pasiva del cliente de Wardogs si ya está en primer plano. No pide ni recupera el foco. Comprueba proceso, límites de una pantalla, posición y foco antes/después; si no puede hacerlo escribe un estado no disponible. Una captura válida guarda un PNG con identificador único y fechas del intervalo de adquisición. El proceso termina tras analizarla; no hay monitor permanente.

La copia de pantalla puede contener superposiciones. `occlusionVerified` y `captureFreshnessVerified` son falsos en la captura bruta: el consumidor verifica procedencia, intervalo y edad. El clasificador `src/game-screen.cjs` solo describe anclas y nunca autoriza por sí solo una entrada ni acredita partida activa.

Se comprobaron tres diálogos archivados, un menú principal capturado pasivamente el 30/10 y un HUD con manos vacías, salud y brújula. Brave queda desconocido. El monitor `src/screen-reader.cjs` conserva como máximo ocho archivos propios, exige capturas de hasta cinco segundos y no renueva una escena copiando o reanalizando una imagen antigua.

El coordinador automático inicia ese monitor al esperar despliegue o durante el movimiento. Combina las anclas con población y presencia privada reciente; solo entonces renueva la concesión del controlador. No activa ventanas. El ciclo completo real y la navegación automática siguen pendientes.

El ensayo real del 30/10 descubrió omisiones del OCR global a 2560×1440 y cajas expresadas sobre la imagen corregida por `TextAngle`. El lector mantiene la captura original y añade pasadas acotadas de contexto central, brújula, manos y salud, con escalas/márgenes declarados. Los polígonos vuelven a píxeles de la captura original; cada pase conserva su texto, ángulo y región. No convierte etiquetas mal leídas en FISTS: utiliza otra pasada cuando puede reconocerla literalmente. No instala idiomas. La palabra numérica de salud puede compartir fila con iconos y se valida por geometría; se deduplican pasadas sobre la misma ancla.

`node tools/test-image-text.cjs` ejecuta 35 comprobaciones de geometría. Puede recibir PNG de HUD como argumentos para comprobar clasificación, hash inalterado y ausencia de fecha de captura falsa al leer un archivo. Cinco imágenes reales y una captura pasiva reciente pasaron; una lectura completa tardó 1164 ms. El OCR sigue pudiendo fallar: ante incertidumbre el automatismo pausa.