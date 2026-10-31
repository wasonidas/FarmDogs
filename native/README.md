# Control local de movimiento

El uso habitual comienza en **Iniciar seeding** de la app: abre el controlador oculto, espera el umbral de población y comprueba presencia y pantalla antes de activar el movimiento. No requiere hotkeys ni la casilla manual de despliegue. El controlador empieza detenido y recibe órdenes locales con concesiones de tres segundos; si el servicio deja de renovarlas, cancela la entrada.

`bin/WardogsMovement.exe` conserva las herramientas de prueba manual después de compilar. En ese modo hay que confirmar despliegue seguro, sin chat ni menús. El acceso Anti-AFK de FarmDogs prepara una ausencia temporal sin depender de población ni Steam conectado a la app.

También puedes abrirlo con **Ajustar movimiento** en el panel local. Una segunda apertura reutiliza la instancia existente y solicita mostrar sus ajustes; si estaba armada, la detiene antes. La ventana se identifica como **Wardogs - Control de movimiento** en Windows.

Su proceso funciona independientemente del observador: cerrar o reiniciar el panel no termina el controlador. Para detener sus entradas usa F8 o cierra su propia ventana; se mantienen su duración máxima y el límite diario cargado.

- **F7** prueba un solo paso y se detiene; alterna las dos direcciones elegidas entre pruebas.
- **F8** solo detiene. En una sesión automática cancela también cualquier reanudación posterior de esa sesión.
- Intervalo, duración de tecla, duración de sesión e inicio programado en hora de Madrid son configurables. El intervalo es la pausa tras soltar una tecla; con 500 ms de pulsación y 60 s de pausa, los comienzos quedan separados aproximadamente 60,5 s.
- Tras el primer paso, perder el foco del juego detiene la sesión. Durante el movimiento, el controlador no trae el juego al primer plano por sí mismo.
- Cerrar la aplicación o detenerla cancela la pulsación y libera la tecla. Los fallos también detienen la sesión; no hay ráfagas para recuperar retrasos.

La prueba de un paso permite comprobar desplazamiento en una referencia cercana. Una entrada aceptada por Windows no demuestra que el juego la reciba. El modo automático exige una captura reciente de HUD con manos vacías y pausa ante otras pantallas; el OCR no verifica ausencia de superposiciones ni todos los menús posibles. No se ha validado todavía permanencia continua en partida activa de Spain ni acreditación de un VIP nuevo.

Los registros están en `data/movement-events.jsonl` y el estado reciente en `data/movement-state.json`, excluidos de Git. Una prueba de movimiento y un premio de llenado se documentan por separado. La entrada al servidor sigue asistida; el controlador no reconecta automáticamente ni compra recompensas.

Para compilar desde el código: `npm run build:movement`. Usa el compilador de .NET Framework de Windows. Ejecuta 57 comprobaciones de política y un ensayo del controlador real compilado con un teclado simulado: inicio sin hotkeys, exclusión de pulsaciones simultáneas, parada durante una pulsación, concesión vencida y cancelación que impide rearmar. Ninguna de esas pruebas manda entradas nativas. `node tools/build-movement.cjs --staging` deja una compilación aparte. `--until-utc FECHA_ISO` acota una sesión supervisada; `--background` evita mostrar la ventana.

El límite diario opcional se carga al abrir desde `data/movement-run.json`: `{"format":"wardogs-movement-run-v1","dayMadrid":"2026-10-30","stopAtUtc":"2026-10-30T13:30:00Z"}`. Se muestra en la ventana y acorta cualquier sesión de ese día, incluso los pasos F7. Un límite de otro día no afecta a una nueva sesión manual. Un fichero inválido impide abrir el controlador. La duración también queda acotada por el reloj monotónico para que un retroceso del reloj de Windows no prolongue la sesión.

El 30/10 se comprobó movimiento A/D de 500 ms, con liberación y retorno aproximado, en el calentamiento del #2 de Spain estando solo. Se corrigió un fallo real por cálculo negativo del último `Task.Delay`. Una sesión periódica posterior completó tres pasos y se detuvo al perder el foco; no constituye una prueba de 25 minutos ni una validación AFK en partida activa.

Código de teclado: API pública SendInput de Windows y códigos de exploración; sin modificar el juego. Esto no significa que el método esté admitido por la política de Wardogs ni garantiza que su protección acepte esas entradas.

En la prueba real del 30/10 una pérdida breve del HUD reiniciaba el plan y repetía A antes de completar el intervalo. Se corrigió con cadencia por sesión automática: mantiene la siguiente dirección y espera el intervalo desde la liberación, incluso si una pulsación fue cancelada parcialmente. Los resultados antiguos no modifican una sesión nueva. La segunda calibración real ejecutó A de 500 ms y D de 500 ms, con 5,568 s entre liberaciones y retorno visual aproximado; después se restauró el intervalo de 60 s y umbral de 20. Fue en calentamiento y no acredita resistencia AFK en partida activa.
