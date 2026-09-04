import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ======================================================
// 01 — PARÁMETROS
// ======================================================
const valoresIniciales = {
  densidad: 1800,
  tamaño: 0.12,
  dispersión: 0.8,
  amplitud: 3.0,
  frecuencia: 80,
  aleatoriedad: 0.0,
  semilla: 42,
};
const parametros = { ...valoresIniciales };

let inputA = 780;
let inputB = 772;
let deltaRR = 8;
let bpm = 0;
const VENTANA_RR = 12;
const MIN_RR = 400;
const MAX_RR = 1500;
const intervalosRR = [inputA, inputB];
const historialTacograma = [...intervalosRR];
const tiempoZonas = { baja: 0, media: 0, alta: 0 };
let rmssd = 0;
let factorSomatico = 0;
let factorSomaticoObjetivo = 0;
let mediaRRVisual = (inputA + inputB) / 2;
let frecuenciaLatido = 1000 / mediaRRVisual;
let frecuenciaCoherente = 0;
let dispersionRR = 0;
let pulsoRadial = 0;
let siVisual = null;
let siFiltroInicializado = false;

// ======================================================
// 02 — ESCENA: ORBE RESPIRATORIO
// ======================================================
const viewport = document.querySelector("#viewport");
const escena = new THREE.Scene();
escena.background = new THREE.Color(0x080b10);

const camara = new THREE.PerspectiveCamera(
  42,
  viewport ? (viewport.clientWidth / viewport.clientHeight) : 1,
  0.1,
  200
);
camara.position.set(0, 0, 18);

const renderer = new THREE.WebGLRenderer({ antialias: true });
if (viewport) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  viewport.appendChild(renderer.domElement);
}

const controlesOrbita = new OrbitControls(camara, renderer.domElement);
controlesOrbita.enableDamping = true;
controlesOrbita.enableRotate = true;
controlesOrbita.dampingFactor = 0.08;
controlesOrbita.minDistance = 7;
controlesOrbita.maxDistance = 32;
controlesOrbita.target.set(0, 0, 0);

const luzAmbiente = new THREE.AmbientLight(0x243142, 1.2);
escena.add(luzAmbiente);

const luzHemisferica = new THREE.HemisphereLight(0xd9f4ff, 0x10131a, 2.2);
escena.add(luzHemisferica);

// Luz principal
const luzPrincipal = new THREE.PointLight(0x48d6a0, 10, 24);
luzPrincipal.position.set(10, 18, 12);
escena.add(luzPrincipal);

// Luz secundaria para suavizar el contraste
const luzRelleno = new THREE.PointLight(0x4d8dff, 7, 22);
luzRelleno.position.set(-8, 6, -6);
escena.add(luzRelleno);

// Plano base
const grupoCampo = new THREE.Group();
escena.add(grupoCampo);

const reloj = new THREE.Clock();
const paradasCromaticas = [
  { factor: 0.00, color: new THREE.Color("#e45757") },
  { factor: 0.40, color: new THREE.Color("#4c8dff") },
  { factor: 1.00, color: new THREE.Color("#42d392") },
];
const colorTemporal = new THREE.Color();
const colorSomatico = new THREE.Color("#660000");
let anillo = null;
let esferaExterior = null;

// ======================================================
// 04 — REGLAS GENERATIVAS
// ======================================================
function calcularRMSSD() {
  if (intervalosRR.length < 2) return 0;
  let sumaCuadrados = 0;
  for (let indice = 1; indice < intervalosRR.length; indice++) {
    const diferencia = intervalosRR[indice] - intervalosRR[indice - 1];
    sumaCuadrados += diferencia * diferencia;
  }
  return Math.sqrt(sumaCuadrados / (intervalosRR.length - 1));
}

function calcularBaevskySI() {
  if (intervalosRR.length < 10) return 0;
  const intervalosEnSegundos = intervalosRR.map((intervalo) => intervalo / 1000);
  const bins = new Map();
  intervalosEnSegundos.forEach((intervalo) => {
    const indiceBin = Math.floor(intervalo / 0.05);
    bins.set(indiceBin, (bins.get(indiceBin) || 0) + 1);
  });
  if (bins.size === 0) return 0;
  const ordenados = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const [indiceModa, frecuenciaModa] = ordenados[0];
  const moda = (indiceModa + 0.5) * 0.05;
  const amplitudModa = (frecuenciaModa / intervalosEnSegundos.length) * 100;
  const rangoRaw = Math.max(...intervalosEnSegundos) - Math.min(...intervalosEnSegundos);
  const rango = Math.max(rangoRaw, 0.06);
  return moda > 0 ? amplitudModa / (2 * moda * rango) : 0;
}

function calcularCoherenciaRR() {
  if (intervalosRR.length < 6) return 0.5;
  const tiempos = [0];
  for (let indice = 1; indice < intervalosRR.length; indice++) {
    tiempos.push(tiempos[indice - 1] + intervalosRR[indice - 1] / 1000);
  }
  const media = intervalosRR.reduce((suma, intervalo) => suma + intervalo, 0) / intervalosRR.length;
  const centrados = intervalosRR.map((intervalo) => intervalo - media);
  const energiaTotal = centrados.reduce((suma, valor) => suma + valor * valor, 0);
  if (energiaTotal < 1) return 0.5;

  let mejorFrecuencia = 0.04;
  let mejorAjuste = 0;
  for (let paso = 0; paso <= 44; paso++) {
    const frecuencia = 0.04 + paso * 0.005;
    let seno = 0;
    let coseno = 0;
    for (let indice = 0; indice < centrados.length; indice++) {
      const fase = tiempos[indice] * frecuencia * Math.PI * 2;
      seno += centrados[indice] * Math.sin(fase);
      coseno += centrados[indice] * Math.cos(fase);
    }
    const potenciaPico = (seno * seno + coseno * coseno) * 2 / (centrados.length * energiaTotal);
    if (potenciaPico > mejorAjuste) {
      mejorAjuste = potenciaPico;
      mejorFrecuencia = frecuencia;
    }
  }
  const potenciaRuido = Math.max(1 - mejorAjuste, 0.05);
  const coherenceRatio = mejorAjuste / potenciaRuido;
  const coherenceScore = Math.log(coherenceRatio + 1);
  frecuenciaCoherente = mejorFrecuencia;
  dispersionRR = Math.sqrt(energiaTotal / intervalosRR.length);
  return THREE.MathUtils.clamp(coherenceScore, 0.2, 5.0);
}

function actualizarTendenciaBiometrica() {
  rmssd = calcularRMSSD();
  factorSomaticoObjetivo = calcularCoherenciaRR();
  deltaRR = Math.abs(inputA - inputB);

  const siNuevo = calcularBaevskySI();
  if (siNuevo > 0) {
    if (!siFiltroInicializado) {
      siVisual = siNuevo; // Arranca directamente en el primer valor real calculado, sin anclaje artificial
      siFiltroInicializado = true;
    } else {
      // Filtro de paso bajo (15% de reactividad) para evitar saltos erráticos del SI en pantalla
      siVisual = (0.85 * siVisual) + (0.15 * siNuevo);
    }
  }
}

function registrarIntervaloRR(intervalo) {
  const intervaloSeguro = Math.round(intervalo);
  const ultimoRR = intervalosRR.at(-1);
  const diferenciaPorcentual = intervalosRR.length > 0 ? Math.abs(intervaloSeguro - ultimoRR) / ultimoRR : 0;
  if (intervaloSeguro < MIN_RR || intervaloSeguro > MAX_RR || diferenciaPorcentual > 0.20) return;

  inputA = inputB;
  inputB = intervaloSeguro;
  intervalosRR.push(intervaloSeguro);
  historialTacograma.push(intervaloSeguro);
  if (historialTacograma.length > 50) historialTacograma.shift();
  if (faseActual === estadoFases?.RECUPERACION) {
    const zona = obtenerZonaCoherencia(factorSomaticoObjetivo);
    tiempoZonas[zona] += intervaloSeguro / 1000;
  }
  if (intervalosRR.length > VENTANA_RR) intervalosRR.shift();
  actualizarTendenciaBiometrica();
  actualizarLecturaBiometrica();
}

function obtenerZonaCoherencia(valor) {
  if (valor >= 2.0) return "alta";
  if (valor >= 1.0) return "media";
  return "baja";
}

function actualizarVisualizacionHRV() {
  const escribirTexto = (selector, valor) => {
    const elemento = document.querySelector(selector);
    if (elemento) elemento.textContent = valor;
  };
  const cs = factorSomatico;
  const zona = cs >= 2.0 ? "alta" : cs >= 1.0 ? "media" : "baja";
  const etiquetas = { baja: "Baja coherencia", media: "Coherencia media", alta: "Alta coherencia" };
  const indicador = document.querySelector("#coherence-zone");
  if (indicador) indicador.className = `zone-dot ${zona}`;
  escribirTexto("#coherence-label", etiquetas[zona]);
  escribirTexto("#coherence-score", `${cs.toFixed(1)} CS`);
  escribirTexto("#metric-coherence", cs.toFixed(1));
  escribirTexto("#txt-bpm", bpm || "--");
  escribirTexto("#metric-bpm", bpm || "--");
  escribirTexto("#txt-rr", Math.round(mediaRRVisual));
  escribirTexto("#metric-rr", Math.round(mediaRRVisual));
  escribirTexto("#txt-rmssd", rmssd.toFixed(1));
  escribirTexto("#metric-rmssd", rmssd.toFixed(1));
  escribirTexto("#txt-si", siVisual === null ? "--" : siVisual.toFixed(1));

  const total = Object.values(tiempoZonas).reduce((suma, valor) => suma + valor, 0);
  const idsZona = { baja: "low", media: "medium", alta: "high" };
  for (const [nombre, tiempo] of Object.entries(tiempoZonas)) {
    const porcentaje = total ? Math.round((tiempo / total) * 100) : 0;
    const elementoZona = document.querySelector(`#zone-${idsZona[nombre]}`);
    if (elementoZona) elementoZona.textContent = `${porcentaje}%`;
  }
  dibujarTacograma();
}

function dibujarTacograma() {
  const lienzo = document.querySelector("#tacogram");
  if (!lienzo) return;
  const escala = window.devicePixelRatio || 1;
  const ancho = lienzo.clientWidth || 420;
  const alto = lienzo.clientHeight || 150;
  lienzo.width = ancho * escala;
  lienzo.height = alto * escala;
  const contexto = lienzo.getContext("2d");
  contexto.scale(escala, escala);
  contexto.clearRect(0, 0, ancho, alto);
  const valores = historialTacograma;
  if (valores.length < 2) return;
  const minimo = Math.min(...valores) - 20;
  const maximo = Math.max(...valores) + 20;
  contexto.strokeStyle = "#42d392";
  contexto.lineWidth = 2;
  contexto.beginPath();
  valores.forEach((valor, indice) => {
    const x = (indice / (valores.length - 1)) * ancho;
    const y = alto - ((valor - minimo) / Math.max(maximo - minimo, 1)) * (alto - 12) - 6;
    if (indice === 0) contexto.moveTo(x, y);
    else contexto.lineTo(x, y);
  });
  contexto.stroke();
  const rrRangeEl = document.querySelector("#rr-range");
  if (rrRangeEl) rrRangeEl.textContent = `${Math.round(minimo + 20)}–${Math.round(maximo - 20)} ms`;
}

function mapearColorSomatico(factor, destino) {
  const valor = THREE.MathUtils.clamp((factor - 0.2) / 1.8, 0, 1);
  for (let indice = 0; indice < paradasCromaticas.length - 1; indice++) {
    const actual = paradasCromaticas[indice];
    const siguiente = paradasCromaticas[indice + 1];
    if (valor <= siguiente.factor) {
      const proporcion = THREE.MathUtils.inverseLerp(actual.factor, siguiente.factor, valor);
      destino.copy(actual.color).lerp(siguiente.color, proporcion);
      return destino;
    }
  }
  return destino.copy(paradasCromaticas.at(-1).color);
}

function crearAnillo() {
  esferaExterior = new THREE.Mesh(
    new THREE.SphereGeometry(3, 32, 24),
    new THREE.MeshBasicMaterial({ color: "#71817f", wireframe: true, transparent: true, opacity: 0.2 })
  );
  grupoCampo.add(esferaExterior);

  const geometria = new THREE.IcosahedronGeometry(2.5, 5);
  const material = new THREE.MeshStandardMaterial({
    color: "#e45757",
    roughness: 0.25,
    metalness: 0.08,
    emissive: "#e45757",
    emissiveIntensity: 0.35,
  });
  anillo = new THREE.Mesh(geometria, material);
  anillo.castShadow = true;
  grupoCampo.add(anillo);
}

function limpiarCampo() {
  if (!anillo) return;
  grupoCampo.remove(anillo);
  anillo.geometry.dispose();
  anillo.material.dispose();
  if (esferaExterior) {
    grupoCampo.remove(esferaExterior);
    esferaExterior.geometry.dispose();
    esferaExterior.material.dispose();
  }
  anillo = null;
  esferaExterior = null;
}

function generarCampo() {
  limpiarCampo();
  crearAnillo();
}

function actualizarAnillo(tiempo) {
  if (!anillo) return;
  if (esferaExterior) {
    esferaExterior.rotation.y -= 0.0004;
    esferaExterior.rotation.x = Math.sin(tiempo * 0.12) * 0.03;
  }
  // ========================================
  // PACER RESPIRATORIO (Fase 3 solamente)
  // ========================================
  let factorPacer = 0.18;
  if (faseActual === estadoFases.RECUPERACION) {
    const tiempoEnFase = tiempo - tiempoFaseInicio;
    const posicionCiclo = (tiempoEnFase % PACER_CICLO_TOTAL) / PACER_CICLO_TOTAL;
    if (posicionCiclo < PACER_INHALACION / PACER_CICLO_TOTAL) {
      factorPacer = posicionCiclo / (PACER_INHALACION / PACER_CICLO_TOTAL);
    } else {
      const posicionExhalacion = (posicionCiclo - PACER_INHALACION / PACER_CICLO_TOTAL) / (PACER_EXHALACION / PACER_CICLO_TOTAL);
      factorPacer = 1 - posicionExhalacion;
    }
  }
  const escala = (faseActual === estadoFases.RECUPERACION) ? THREE.MathUtils.lerp(0.5, 1.18, factorPacer) : 0.6;
  mapearColorSomatico(factorSomatico, colorTemporal);
  colorSomatico.lerp(colorTemporal, 0.08);
  anillo.material.color.copy(colorSomatico);
  anillo.material.emissive.copy(colorSomatico);
  const brilloCardiaco = 0.04 * Math.sin(tiempo * frecuenciaLatido * Math.PI * 2);
  anillo.material.emissiveIntensity = 0.25 + factorSomatico * 0.65 + brilloCardiaco;
  anillo.scale.setScalar(escala);
  anillo.rotation.y += 0.0015;
  anillo.rotation.x = Math.sin(tiempo * 0.22) * 0.08;
}

function actualizarCampoAnimado() {
  const tiempo = reloj.getElapsedTime();
  if (!caracteristicaFrecuenciaCardiaca && !camaraActiva) actualizarSimulacionAutomatica(tiempo);
  factorSomatico = THREE.MathUtils.lerp(factorSomatico, factorSomaticoObjetivo, 0.04);
  const mediaRRObjetivo = (inputA + inputB) / 2;
  mediaRRVisual = THREE.MathUtils.lerp(mediaRRVisual, mediaRRObjetivo, 0.08);
  const frecuenciaObjetivo = 1000 / Math.max(mediaRRVisual, 1);
  frecuenciaLatido = THREE.MathUtils.lerp(frecuenciaLatido, frecuenciaObjetivo, 0.08);

  // ========================================
  // GESTIÓN DE FASES Y TEMPORIZADORES
  // ========================================
  if (faseActual === estadoFases.BASAL || faseActual === estadoFases.ESTRESANTE || faseActual === estadoFases.RECUPERACION) {
    const tiempoTranscurrido = tiempo - tiempoFaseInicio;
    const tiempoRestante = Math.max(0, tiempoFaseDuracion - tiempoTranscurrido);
    const minutos = Math.floor(tiempoRestante / 60);
    const segundos = Math.floor(tiempoRestante % 60);
    if (timerDisplay) timerDisplay.textContent = `${minutos}:${segundos.toString().padStart(2, '0')}`;
    actualizarHUD(tiempoRestante, tiempoTranscurrido);

    if (timerDisplay) {
      if (tiempoRestante <= 10 && tiempoRestante > 0) {
        timerDisplay.classList.add("warning");
      } else {
        timerDisplay.classList.remove("warning");
      }
    }
    if (tiempoTranscurrido >= tiempoFaseDuracion) {
      terminarFase();
    }
    if (faseActual === estadoFases.RECUPERACION) actualizarLogros(tiempo, tiempoTranscurrido);
  } else {
    document.querySelector("#session-hud")?.classList.add("hidden");
  }
  actualizarAnillo(tiempo);
  actualizarLecturaBiometrica();
}

function actualizarHUD(tiempoRestante, tiempoTranscurrido) {
  const hud = document.querySelector("#session-hud");
  if (!hud) return;
  hud.classList.remove("hidden");
  const minutos = Math.floor(tiempoRestante / 60);
  const segundos = Math.floor(tiempoRestante % 60);
  const timerHud = document.querySelector("#hud-timer");
  if (timerHud) {
    timerHud.textContent = `${minutos.toString().padStart(2, "0")}:${segundos.toString().padStart(2, "0")}`;
    timerHud.classList.toggle("hidden", faseActual === estadoFases.RECUPERACION);
  }
  const guideHud = document.querySelector("#hud-guide");
  if (guideHud) {
    guideHud.textContent = faseActual === estadoFases.BASAL ? "Respira naturalmente" : 
                           faseActual === estadoFases.ESTRESANTE ? "Responde al color de la tinta" : 
                           ((tiempoTranscurrido % PACER_CICLO_TOTAL) < PACER_INHALACION ? "Inhala" : "Exhala");
  }
}

function actualizarLogros(tiempo, tiempoTranscurrido) {
  const delta = Math.min(Math.max(tiempo - ultimoTiempoSesion, 0), 0.5);
  acumuladoCS += factorSomatico * delta;
  tiempoCS += delta;
  ultimoTiempoSesion = tiempo;
  const bloqueActual = Math.floor(tiempoTranscurrido / 5);
  while (ultimoBloqueLogro < bloqueActual) {
    ultimoBloqueLogro += 1;
    puntosLogro += factorSomatico >= 2.0 ? 2 : factorSomatico >= 1.0 ? 1 : 0;
  }
}

function mostrarHistorialCompleto() {
  const sesiones = registroHistorial.slice(-10);
  const historySummary = document.querySelector("#history-summary");
  if (historySummary) {
    historySummary.innerHTML = sesiones
      .map((registro, indice) => `<span>Sesión ${indice + 1}: ${(registro.avgCS ?? registro.coherencia ?? 0).toFixed(1)} CS · ${(registro.rmssdFinal ?? 0).toFixed(1)} ms RMSSD</span>`)
      .join("");
  }
  dibujarHistorial(sesiones);
  document.querySelector("#history-dialog")?.showModal();
}

function dibujarHistorial(sesiones) {
  const lienzo = document.querySelector("#history-chart");
  if (!lienzo) return;
  const escala = window.devicePixelRatio || 1;
  const ancho = lienzo.clientWidth || 520;
  const alto = lienzo.clientHeight || 240;
  lienzo.width = ancho * escala;
  lienzo.height = alto * escala;
  const contexto = lienzo.getContext("2d");
  contexto.scale(escala, escala);
  contexto.clearRect(0, 0, ancho, alto);
  if (!sesiones.length) return;
  const valores = [
    sesiones.map((registro) => registro.avgCS ?? registro.coherencia ?? 0),
    sesiones.map((registro) => registro.rmssdFinal || 0),
  ];
  const maximo = Math.max(...valores.flat(), 1);
  ["#42d392", "#4c8dff"].forEach((color, serie) => {
    contexto.strokeStyle = color;
    contexto.lineWidth = 2;
    contexto.beginPath();
    valores[serie].forEach((valor, indice) => {
      const x = sesiones.length === 1 ? ancho / 2 : 12 + (indice / (sesiones.length - 1)) * (ancho - 24);
      const y = alto - 18 - (valor / maximo) * (alto - 36);
      if (indice === 0) contexto.moveTo(x, y);
      else contexto.lineTo(x, y);
    });
    contexto.stroke();
  });
  contexto.font = "11px system-ui";
  contexto.fillStyle = "#42d392";
  contexto.fillText("CS", 12, 16);
  contexto.fillStyle = "#4c8dff";
  contexto.fillText("RMSSD", 42, 16);
}

function actualizarSimulacionAutomatica(tiempo) {
  const relajacion = THREE.MathUtils.clamp(parametros.aleatoriedad / 1.5, 0, 1);
  const bpmPorEstado = THREE.MathUtils.lerp(140, 60, relajacion);
  const bpmSimuladoObjetivo = THREE.MathUtils.clamp(
    bpmPorEstado * (parametros.frecuencia / 80),
    60,
    140
  );
  const intervaloSimulado = 60000 / bpmSimuladoObjetivo;
  inputA = Math.round(THREE.MathUtils.lerp(inputA, intervaloSimulado, 0.015));
  inputB = Math.round(THREE.MathUtils.lerp(inputB, intervaloSimulado, 0.015));
  mediaRRVisual = THREE.MathUtils.lerp(mediaRRVisual, intervaloSimulado, 0.08);
  factorSomaticoObjetivo = THREE.MathUtils.lerp(0.2, 2.8, relajacion);
  deltaRR = Math.abs(inputA - inputB);
  rmssd = deltaRR;
}

function aleatoriedadConSemilla(x, z, semilla) {
  const valor = Math.sin(
    x * 12.9898 + z * 78.233 + semilla * 37.719
  ) * 43758.5453;
  const normalizado = valor - Math.floor(valor);
  return normalizado * 2 - 1;
}

// ======================================================
// 07 — SISTEMA DE FASES Y BIOFEEDBACK
// ======================================================
const estadoFases = {
  ESPERA: 0,
  BASAL: 1,
  ESTRESANTE: 2,
  RECUPERACION: 3,
  RESULTADOS: 4
};
let faseActual = estadoFases.ESPERA;
let tiempoFaseInicio = 0;
let tiempoFaseDuracion = 0;
let rmssdBasal = 0;
let rmssdEstresante = 0;
let rmssdRecuperacion = 0;
let siBasal = 0;
let siEstresante = 0;
let siRecuperacion = 0;
let sujetoID = "";
let registroHistorial = [];
let puntosLogro = 0;
let acumuladoCS = 0;
let tiempoCS = 0;
let ultimoTiempoSesion = 0;
let ultimoBloqueLogro = 0;
let chartInstancia = null;
const PACER_FRECUENCIA = 0.1;
const PACER_CICLO_TOTAL = 1 / PACER_FRECUENCIA;
const PACER_INHALACION = 4;
const PACER_EXHALACION = 6;

function cargarHistorial() {
  try {
    const datos = localStorage.getItem("muestreo_ssrr_tesis");
    registroHistorial = datos ? JSON.parse(datos) : [];
  } catch (error) {
    console.error("Error cargando historial:", error);
    registroHistorial = [];
  }
}

function guardarHistorial() {
  try {
    localStorage.setItem("muestreo_ssrr_tesis", JSON.stringify(registroHistorial));
  } catch (error) {
    console.error("Error guardando historial:", error);
  }
}

function iniciarEvaluacionBasal() {
  if (aclimatandose) return;
  if (faseActual !== estadoFases.ESPERA && faseActual !== estadoFases.RESULTADOS) return;

  // MODO SIMULACIÓN AUTOMÁTICO: Si no hay hardware activo (por ejemplo, en el Integrated Browser de VS Code),
  // se activa automáticamente una simulación de datos para que Eduardo pueda testear y presentar la web sin hardware físico.
  if (!caracteristicaFrecuenciaCardiaca && !camaraActiva) {
    console.info("MODO SIMULACIÓN AUTOMÁTICO ACTIVADO: No se detecta hardware (Cámara/Bluetooth).");
    window.simulacionActiva = true;
  } else {
    window.simulacionActiva = false;
  }

  let idIngresado = null;
  try {
    idIngresado = prompt("ID del participante:");
  } catch (error) {
    // En algunos entornos (p. ej. el "Simple Browser" / Live Preview de VS Code,
    // que carga la página dentro de un <iframe sandbox> sin "allow-modals"),
    // window.prompt() lanza una excepción y detenía toda la función aquí.
    console.warn("prompt() no disponible en este entorno (probablemente un webview con sandbox). Se usará un ID automático.", error);
  }
  sujetoID = idIngresado?.trim() || `Sujeto_${registroHistorial.length + 1}`;
  document.querySelector("#results-dialog")?.close();
  faseActual = estadoFases.BASAL;
  tiempoFaseInicio = reloj.getElapsedTime();
  tiempoFaseDuracion = 60;
  if (timerDisplay) {
    timerDisplay.classList.remove("complete");
    timerDisplay.textContent = "1:00";
  }
  actualizarInstrucciones(
    "Línea Base",
    "Reposo absoluto en silencio. Registro basal durante 60 segundos.",
    60
  );
  actualizarBotonesPhase();
  console.log("[FASE 1] Línea base iniciada - 60 segundos");
}

function iniciarFaseEstresante() {
  if ((!caracteristicaFrecuenciaCardiaca && !camaraActiva && !window.simulacionActiva) || faseActual !== estadoFases.BASAL) {
    console.warn("Sensor Bluetooth no conectado");
    return;
  }
  faseActual = estadoFases.ESTRESANTE;
  tiempoFaseInicio = reloj.getElapsedTime();
  tiempoFaseDuracion = 60;
  iniciarStroop();
  actualizarInstrucciones(
    "Estresor Atencional",
    "Selecciona el color de la tinta, ignorando la palabra.",
    60
  );
  console.log("[FASE 2] Estresor atencional iniciado - 60 segundos");
}

function terminarFase() {
  if (faseActual === estadoFases.BASAL) {
    rmssdBasal = rmssd;
    siBasal = calcularBaevskySI();
    iniciarFaseEstresante();
  } else if (faseActual === estadoFases.ESTRESANTE) {
    rmssdEstresante = rmssd;
    siEstresante = calcularBaevskySI();
    detenerStroop();
    iniciarRecuperacion();
  } else if (faseActual === estadoFases.RECUPERACION) {
    rmssdRecuperacion = rmssd;
    siRecuperacion = calcularBaevskySI();
    const registro = {
      id: sujetoID,
      fecha: new Date().toISOString(),
      rmssdBasal: parseFloat(rmssdBasal.toFixed(1)),
      siBasal: parseFloat(siBasal.toFixed(2)),
      rmssdEstresante: parseFloat(rmssdEstresante.toFixed(1)),
      siEstresante: parseFloat(siEstresante.toFixed(2)),
      rmssdRecuperacion: parseFloat(rmssdRecuperacion.toFixed(1)),
      siRecuperacion: parseFloat(siRecuperacion.toFixed(2)),
    };
    registroHistorial.push(registro);
    guardarHistorial();
    faseActual = estadoFases.RESULTADOS;
    mostrarDashboardFinal(registro);
  }
}

function iniciarRecuperacion() {
  faseActual = estadoFases.RECUPERACION;
  tiempoFaseInicio = reloj.getElapsedTime();
  tiempoFaseDuracion = 60;
  actualizarInstrucciones("Amortiguación Vagal", "Respiración guiada: inhala 4 segundos y exhala 6 segundos.", 60);
}

function actualizarInstrucciones(titulo, texto, duracion) {
  const overlay = document.querySelector("#phase-overlay");
  const titleEl = document.querySelector("#instruction-title");
  const textEl = document.querySelector("#instruction-text");
  if (titleEl) titleEl.textContent = titulo;
  if (textEl) textEl.textContent = texto;
  const configEl = document.querySelector("#training-config");
  if (configEl) configEl.classList.add("hidden");
  if (overlay) {
    overlay.classList.toggle("hidden", faseActual !== estadoFases.BASAL && faseActual !== estadoFases.ESTRESANTE);
  }
}

function iniciarStroop() {
  const overlay = document.querySelector("#stroop-overlay") || document.body.appendChild(Object.assign(document.createElement("div"), { id: "stroop-overlay" }));
  overlay.className = "stroop-overlay";
  overlay.innerHTML = `<div class="stroop-card">
    <p class="eyebrow">TAREA DE ATENCIÓN</p>
    <h2 id="stroop-word"></h2>
    <p id="stroop-feedback">Selecciona el color de la tinta</p>
    <div id="stroop-options" class="stroop-options"></div>
  </div>`;
  const colores = { ROJO: "#e45757", VERDE: "#42d392", AZUL: "#4c8dff", AMARILLO: "#f0c75e" };
  const palabra = document.querySelector("#stroop-word");
  const opciones = document.querySelector("#stroop-options");
  const mezclarArray = (array) => {
    const copia = [...array];
    for (let indice = copia.length - 1; indice > 0; indice--) {
      const indiceAleatorio = Math.floor(Math.random() * (indice + 1));
      [copia[indice], copia[indiceAleatorio]] = [copia[indiceAleatorio], copia[indice]];
    }
    return copia;
  };
  const siguiente = () => {
    const nombres = Object.keys(colores);
    const texto = nombres[Math.floor(Math.random() * nombres.length)];
    let tinta = nombres[Math.floor(Math.random() * nombres.length)];
    while (tinta === texto) tinta = nombres[Math.floor(Math.random() * nombres.length)];
    if (palabra) {
      palabra.textContent = texto;
      palabra.dataset.tinta = tinta;
      palabra.style.color = colores[tinta];
    }
    if (opciones) {
      // Orden de los botones aleatorio en cada ronda para que no se puedan memorizar posiciones
      opciones.innerHTML = mezclarArray(nombres).map((nombre) => `<button type="button" data-color="${nombre}">${nombre}</button>`).join("");
    }
  };
  if (opciones) {
    opciones.addEventListener("click", (evento) => {
      const boton = evento.target.closest("button");
      if (!boton) return;
      const feedback = document.querySelector("#stroop-feedback");
      if (feedback) {
        const esCorrecta = boton.dataset.color === palabra.dataset.tinta;
        feedback.textContent = esCorrecta ? "Correcto" : "Error: Respuesta Equivocada";
        feedback.style.color = esCorrecta ? "#42d392" : "#e45757";
      }
      siguiente();
    });
  }
  siguiente();
}

function detenerStroop() {
  document.querySelector("#stroop-overlay")?.remove();
}

function mostrarDashboardFinal(registro = registroHistorial.at(-1)) {
  const fases = [
    ["Basal", registro.rmssdBasal, registro.siBasal],
    ["Estresante", registro.rmssdEstresante, registro.siEstresante],
    ["Recuperación", registro.rmssdRecuperacion, registro.siRecuperacion],
  ];
  const resultsContent = document.querySelector("#results-content");
  if (resultsContent) {
    resultsContent.innerHTML = `<p class="report-comparison">Participante: <strong>${registro.id || "Sin ID"}</strong></p>
    <div class="dashboard-table">
      <div class="dashboard-row dashboard-head">
        <strong>Fase</strong>
        <strong>RMSSD (ms)</strong>
        <strong>SI</strong>
      </div>
      ${fases.map(([nombre, valorRMSSD, valorSI]) => `
        <div class="dashboard-row">
          <span>${nombre}</span>
          <strong>${Number(valorRMSSD || 0).toFixed(1)}</strong>
          <strong>${Number(valorSI || 0).toFixed(2)}</strong>
        </div>
      `).join("")}
    </div>`;
  }
  document.querySelector("#results-dialog")?.showModal();
}

function exportarMuestreoCSV() {
  const registros = JSON.parse(localStorage.getItem("muestreo_ssrr_tesis") || "[]");
  const columnas = ["ID_Sujeto", "Fecha", "RMSSD_Basal", "SI_Basal", "RMSSD_Estresante", "SI_Estresante", "RMSSD_Recuperacion", "SI_Recuperacion"];
  const escaparCSV = (valor) => `"${String(valor ?? "").replaceAll('"', '""')}"`;
  const filas = registros.map((registro) => [
    registro.id,
    registro.fecha,
    registro.rmssdBasal,
    registro.siBasal,
    registro.rmssdEstresante,
    registro.siEstresante,
    registro.rmssdRecuperacion,
    registro.siRecuperacion
  ].map(escaparCSV).join(","));
  const blob = new Blob([[columnas.join(","), ...filas].join("\n")], { type: "text/csv;charset=utf-8" });
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(blob);
  enlace.download = "Muestreo_Duelo_Somatico_UAI.csv";
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

function renderizarGraficoComparativo() {
  const lienzo = document.querySelector("#grafico-tendencia-sesion");
  if (!lienzo || typeof Chart === "undefined") return;

  if (chartInstancia) chartInstancia.destroy();

  // Últimas 10 sesiones (mismo tope que usa el historial en mostrarHistorialCompleto).
  // Si no hay ninguna sesión guardada, se grafica la sesión activa con los valores en memoria.
  const sesiones = registroHistorial.length
    ? registroHistorial.slice(-10)
    : [{ id: "Sesión actual", rmssdBasal, siBasal, rmssdEstresante, siEstresante, rmssdRecuperacion, siRecuperacion }];

  const COLOR_RMSSD_PREVIA = "rgba(76, 141, 255, 0.35)";
  const COLOR_SI_PREVIA = "rgba(228, 87, 87, 0.35)";
  const COLOR_DESTACADO = "#f0c75e";

  const datasets = sesiones.flatMap((sesion, indice) => {
    const esUltima = indice === sesiones.length - 1;
    const nombreSesion = sesion.id || `Sesión ${indice + 1}`;
    return [
      {
        // Línea sólida = RMSSD (tono vagal)
        label: `RMSSD · ${nombreSesion}`,
        data: [sesion.rmssdBasal || 0, sesion.rmssdEstresante || 0, sesion.rmssdRecuperacion || 0],
        borderColor: esUltima ? COLOR_DESTACADO : COLOR_RMSSD_PREVIA,
        backgroundColor: esUltima ? COLOR_DESTACADO : COLOR_RMSSD_PREVIA,
        borderWidth: esUltima ? 3 : 1.5,
        pointStyle: "circle",
        pointRadius: esUltima ? 4 : 2,
        tension: 0.3,
        yAxisID: "yRmssd",
        destacar: esUltima,
        metrica: "RMSSD",
      },
      {
        // Línea punteada = Stress Index (Baevsky)
        label: `SI · ${nombreSesion}`,
        data: [sesion.siBasal || 0, sesion.siEstresante || 0, sesion.siRecuperacion || 0],
        borderColor: esUltima ? COLOR_DESTACADO : COLOR_SI_PREVIA,
        backgroundColor: esUltima ? COLOR_DESTACADO : COLOR_SI_PREVIA,
        borderWidth: esUltima ? 3 : 1.5,
        borderDash: [6, 4],
        pointStyle: "triangle",
        pointRadius: esUltima ? 5 : 2,
        tension: 0.3,
        yAxisID: "ySi",
        destacar: esUltima,
        metrica: "SI",
      },
    ];
  });

  chartInstancia = new Chart(lienzo, {
    type: "line",
    data: {
      labels: ["Línea Base", "Stroop Test (Estrés)", "Respiración (Recuperación)"],
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        yRmssd: {
          type: "linear",
          position: "left",
          title: { display: true, text: "RMSSD (ms) — línea sólida ●", color: "#4c8dff" },
          ticks: { color: "#4c8dff" },
        },
        ySi: {
          type: "linear",
          position: "right",
          title: { display: true, text: "Stress Index — línea punteada ▲", color: "#e45757" },
          ticks: { color: "#e45757" },
          grid: { drawOnChartArea: false },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: "#d9f4ff",
            // Solo se listan en la leyenda las 2 curvas de la sesión más reciente (resaltada);
            // las sesiones previas siguen visibles en el gráfico para evidenciar la tendencia.
            filter: (item, data) => Boolean(data.datasets[item.datasetIndex]?.destacar),
          },
        },
        tooltip: {
          callbacks: {
            label: (contexto) => `${contexto.dataset.metrica}: ${contexto.formattedValue}${contexto.dataset.metrica === "RMSSD" ? " ms" : ""} (${contexto.dataset.label.split("· ")[1]})`,
          },
        },
      },
    },
  });
}

function mostrarResultados(registro) {
  const anterior = registroHistorial.at(-2);
  const altaAnterior = anterior?.zonas?.alta || 0;
  const diferenciaAlta = registro.zonas ? (registro.zonas.alta - altaAnterior) : 0;
  const comparativa = anterior ? `Lograste un ${diferenciaAlta >= 0 ? "+" : ""}${diferenciaAlta}% de tiempo en coherencia alta frente a tu sesión anterior.` : "Esta es tu primera sesión guardada; úsala como punto de referencia.";
  const zonas = ["baja", "media", "alta"];
  const colores = { baja: "#e45757", media: "#4c8dff", alta: "#42d392" };
  const resultsContent = document.querySelector("#results-content");
  if (resultsContent) {
    resultsContent.innerHTML = `<div class="report-highlight">
      <span>Coherencia promedio</span>
      <strong>${(registro.avgCS ?? 0).toFixed(1)} CS</strong>
      <span class="achievement">${registro.puntosLogro || 0} pts de logro</span>
    </div>
    <p class="report-comparison">${comparativa}</p>
    <h3>Tiempo en coherencia</h3>
    <div class="zone-report">
      ${zonas.map((zona) => `<div><span><i style="background:${colores[zona]}"></i> ${zona}</span><strong>${registro.zonas ? (registro.zonas[zona] || 0) : 0}%</strong></div>`).join("")}
    </div>
    <h3>Resumen biométrico</h3>
    <div class="biometric-report">
      <div><span>RMSSD final</span><strong>${(registro.rmssdFinal ?? 0).toFixed(1)} ms</strong></div>
      <div><span>BPM final</span><strong>${registro.bpmFinal || "--"}</strong></div>
    </div>`;
  }
  document.querySelector("#session-hud")?.classList.add("hidden");
  document.querySelector("#results-dialog")?.showModal();
}

function mostrarResultadosBasales(registro) {
  const overlay = document.querySelector("#phase-overlay");
  const title = document.querySelector("#instruction-title");
  const text = document.querySelector("#instruction-text");
  if (title) title.textContent = "Resultados basales";
  if (text) {
    text.innerHTML = `<strong>RMSSD: ${registro.rmssd.toFixed(1)} ms</strong><br>
    Coherencia inicial: <strong>${registro.coherencia.toFixed(2)}</strong><br><br>
    Tu nivel de coherencia de reposo indica tu estado actual de tono vagal y flexibilidad autonómica antes de ejercitar.`;
  }
  if (timerDisplay) timerDisplay.textContent = "01:00";
  const configEl = document.querySelector("#training-config");
  if (configEl) configEl.classList.remove("hidden");
  overlay?.classList.remove("hidden");
}

function actualizarBotonesPhase() {
  const btn1 = document.querySelector("#fase-basal");
  const btn2 = document.querySelector("#fase-estres");
  const btn3 = document.querySelector("#fase-recuperacion");
  const btnAccion = document.querySelector("#btn-accion-sesion");
  const phaseInfo = document.querySelector("#phase-info");
  const estaConectado = Boolean(caracteristicaFrecuenciaCardiaca || camaraActiva);
  if (btnAccion) {
    btnAccion.disabled = aclimatandose || faseActual === estadoFases.BASAL || faseActual === estadoFases.ESTRESANTE || faseActual === estadoFases.RECUPERACION;
  }
  [btn1, btn2, btn3].forEach((btn) => btn?.classList.remove("active"));
  if (faseActual === estadoFases.BASAL) btn1?.classList.add("active");
  if (faseActual === estadoFases.ESTRESANTE) btn2?.classList.add("active");
  if (faseActual === estadoFases.RECUPERACION) btn3?.classList.add("active");
  if (btnAccion) {
    btnAccion.textContent = aclimatandose ? "Estabilizando señal (Espera 10s)..." :
                            faseActual === estadoFases.BASAL ? "Grabando línea base (60s)..." :
                            faseActual === estadoFases.ESTRESANTE ? "Ejecutando Stroop Test..." :
                            faseActual === estadoFases.RECUPERACION ? "Respirando (0.1 Hz)..." : "Iniciar medición basal";
  }
  if (phaseInfo) {
    if (aclimatandose) {
      phaseInfo.textContent = "Estabilizando señal, espera unos segundos...";
    } else if (faseActual === estadoFases.ESPERA) {
      phaseInfo.textContent = estaConectado ? "Listo para iniciar sesión" : "Listo para iniciar (Simulador automático activo)";
    } else if (faseActual === estadoFases.BASAL) {
      phaseInfo.textContent = `RMSSD: ${rmssd.toFixed(1)} ms | SI: ${calcularBaevskySI().toFixed(2)}`;
    } else if (faseActual === estadoFases.ESTRESANTE) {
      phaseInfo.textContent = `Basal RMSSD: ${rmssdBasal.toFixed(1)} ms | Actual RMSSD: ${rmssd.toFixed(1)} ms | SI: ${calcularBaevskySI().toFixed(2)}`;
    } else if (faseActual === estadoFases.RECUPERACION) {
      phaseInfo.textContent = `Estresante RMSSD: ${rmssdEstresante.toFixed(1)} ms | Actual RMSSD: ${rmssd.toFixed(1)} ms | SI: ${calcularBaevskySI().toFixed(2)}`;
    }
  }
}

// ======================================================
// 08 — INTERFAZ Y CONEXIÓN BLUETOOTH / CÁMARA
// ======================================================
let dispositivoBluetooth = null;
let caracteristicaFrecuenciaCardiaca = null;
let estadoConexion = "Desconectado";
let flujoCamara = null;
let camaraActiva = false;
let cuadroCamara = null;
let videoCamara = null;
let muestrasPPG = [];
let ultimaCrestaPPG = 0;
let aclimatandose = false;
let temporizadorAclimatacion = null;

const botonConectar = document.querySelector("#btn-conectar");
const botonCamara = document.querySelector("#btn-camara");
const statusConexion = document.querySelector("#status-conexion");
const btnAccion = document.querySelector("#btn-accion-sesion");
const overlayInstrucciones = document.querySelector("#phase-overlay");
const timerDisplay = document.querySelector("#timer-display");

function actualizarEstadoBluetooth(estado, conectado = false) {
  estadoConexion = estado;
  if (statusConexion) statusConexion.textContent = estado;
  if (conectado) {
    statusConexion?.classList.add("connected");
  } else {
    statusConexion?.classList.remove("connected");
  }
  actualizarBotonesPhase();
}

function iniciarBufferAclimatacion() {
  clearTimeout(temporizadorAclimatacion);
  aclimatandose = true;
  actualizarBotonesPhase();
  temporizadorAclimatacion = setTimeout(() => {
    aclimatandose = false;
    actualizarBotonesPhase();
  }, 10000);
}

async function iniciarCamaraPPG() {
  if (!navigator.mediaDevices?.getUserMedia) {
    actualizarEstadoBluetooth("Cámara no disponible en este navegador");
    return;
  }
  try {
    actualizarEstadoBluetooth("Solicitando acceso a la cámara...");
    const configuracionCamara = {
      video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    };
    try {
      flujoCamara = await navigator.mediaDevices.getUserMedia(configuracionCamara);
    } catch (error) {
      if (error.name !== "OverconstrainedError" && error.name !== "NotFoundError") throw error;
      flujoCamara = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    videoCamara = document.querySelector("#camera-preview");
    if (videoCamara) {
      videoCamara.srcObject = flujoCamara;
      videoCamara.classList.add("active");
      await videoCamara.play();
    }
    const pista = flujoCamara.getVideoTracks()[0];
    if (pista.getCapabilities?.().torch) {
      try {
        await pista.applyConstraints({ advanced: [{ torch: true }] });
      } catch (error) {
        console.info("El flash no está disponible; continúa sin flash.", error);
      }
    }
    cuadroCamara = document.createElement("canvas");
    cuadroCamara.width = 32;
    cuadroCamara.height = 32;
    muestrasPPG = [];
    ultimaCrestaPPG = 0;
    camaraActiva = true;
    if (botonCamara) {
      botonCamara.textContent = "Cámara activa · detener";
      botonCamara.onclick = detenerCamaraPPG;
    }
    actualizarEstadoBluetooth("Cámara activa · coloca el dedo sobre el lente", true);
    iniciarBufferAclimatacion();
    leerPulsoCamara();
  } catch (error) {
    detenerCamaraPPG();
    actualizarEstadoBluetooth(error.name === "NotAllowedError" ? "Permiso de cámara rechazado" : "No se pudo activar la cámara");
  }
}

function detenerCamaraPPG() {
  flujoCamara?.getTracks().forEach((pista) => pista.stop());
  flujoCamara = null;
  camaraActiva = false;
  if (videoCamara) {
    videoCamara.srcObject = null;
    videoCamara.classList.remove("active");
  }
  if (botonCamara) {
    botonCamara.textContent = "Usar cámara como sensor";
    botonCamara.onclick = iniciarCamaraPPG;
  }
  if (estadoConexion.startsWith("Cámara")) actualizarEstadoBluetooth("Desconectado", false);
  actualizarBotonesPhase();
}

function leerPulsoCamara() {
  if (!camaraActiva || !videoCamara?.videoWidth) {
    if (camaraActiva) requestAnimationFrame(leerPulsoCamara);
    return;
  }
  const contexto = cuadroCamara.getContext("2d", { willReadFrequently: true });
  contexto.drawImage(videoCamara, 0, 0, 32, 32);
  const pixeles = contexto.getImageData(0, 0, 32, 32).data;
  let rojo = 0;
  let verde = 0;
  for (let indice = 0; indice < pixeles.length; indice += 4) {
    rojo += pixeles[indice];
    verde += pixeles[indice + 1];
  }
  const cantidadPixeles = pixeles.length / 4;
  muestrasPPG.push({ tiempo: performance.now(), valor: rojo / cantidadPixeles - verde / cantidadPixeles });
  if (muestrasPPG.length > 40) muestrasPPG.shift();
  detectarLatidoPPG();
  requestAnimationFrame(leerPulsoCamara);
}

function detectarLatidoPPG() {
  if (muestrasPPG.length < 7) return;
  const candidato = muestrasPPG.at(-4);
  const vecinos = muestrasPPG.slice(-7);
  const promedio = vecinos.reduce((suma, muestra) => suma + muestra.valor, 0) / vecinos.length;
  const desviacion = Math.sqrt(vecinos.reduce((suma, muestra) => suma + (muestra.valor - promedio) ** 2, 0) / vecinos.length);
  const esCresta = candidato.valor === Math.max(...vecinos.map((muestra) => muestra.valor));
  const intervalo = candidato.tiempo - ultimaCrestaPPG;
  if (!esCresta || candidato.valor < promedio + desviacion * 0.35) return;
  if (!ultimaCrestaPPG) {
    ultimaCrestaPPG = candidato.tiempo;
    return;
  }
  if (intervalo < 350 || intervalo > 1500) return;
  ultimaCrestaPPG = candidato.tiempo;
  bpm = Math.round(60000 / intervalo);
  registrarIntervaloRR(intervalo);
}

function decodificarMedicionFrecuenciaCardiaca(event) {
  const datos = event.target.value;
  if (!datos || datos.byteLength < 2) return;
  const banderas = datos.getUint8(0);
  const usaHR16Bits = (banderas & 0x01) !== 0;
  const tieneRR = (banderas & 0x10) !== 0;
  let indice = 1;
  bpm = usaHR16Bits ? datos.getUint16(indice, true) : datos.getUint8(indice);
  indice += usaHR16Bits ? 2 : 1;
  if ((banderas & 0x08) !== 0) indice += 2;
  if (!tieneRR || indice + 1 >= datos.byteLength) {
    actualizarLecturaBiometrica();
    return;
  }
  while (indice + 1 < datos.byteLength) {
    const rrEnUnidadesBluetooth = datos.getUint16(indice, true);
    const rrMilisegundos = Math.round((rrEnUnidadesBluetooth * 1000) / 1024);
    indice += 2;
    if (rrMilisegundos >= 300 && rrMilisegundos <= 2000) {
      registrarIntervaloRR(rrMilisegundos);
    }
  }
  actualizarLecturaBiometrica();
}

async function conectarSensorCardiaco() {
  if (!window.isSecureContext) {
    actualizarEstadoBluetooth("Bluetooth requiere HTTPS o localhost");
    return;
  }
  if (!navigator.bluetooth?.requestDevice) {
    actualizarEstadoBluetooth("Usa Chrome o Edge para conectar Bluetooth");
    return;
  }
  try {
    actualizarEstadoBluetooth("Buscando sensor...");
    dispositivoBluetooth = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
      optionalServices: ["heart_rate"],
    });
    dispositivoBluetooth.addEventListener("gattserverdisconnected", () => {
      caracteristicaFrecuenciaCardiaca = null;
      actualizarEstadoBluetooth("Desconectado", false);
      faseActual = estadoFases.ESPERA;
      overlayInstrucciones.classList.add("hidden");
      actualizarLecturaBiometrica();
    });
    const servidor = await dispositivoBluetooth.gatt.connect();
    const servicio = await servidor.getPrimaryService("heart_rate");
    caracteristicaFrecuenciaCardiaca = await servicio.getCharacteristic("heart_rate_measurement");
    await caracteristicaFrecuenciaCardiaca.startNotifications();
    caracteristicaFrecuenciaCardiaca.addEventListener("characteristicvaluechanged", decodificarMedicionFrecuenciaCardiaca);
    actualizarEstadoBluetooth(`✓ ${dispositivoBluetooth.name || "Coospo H6M"}`, true);
    actualizarLecturaBiometrica();
    iniciarBufferAclimatacion();
  } catch (error) {
    caracteristicaFrecuenciaCardiaca = null;
    const mensajes = {
      NotFoundError: "No se seleccionó ningún sensor",
      SecurityError: "Bluetooth bloqueado por permisos del navegador",
      NotSupportedError: "Este navegador no admite Web Bluetooth",
      InvalidStateError: "Activa Bluetooth en el computador",
    };
    const mensajeError = mensajes[error.name] || "No se pudo conectar al sensor";
    actualizarEstadoBluetooth(mensajeError, false);
    actualizarLecturaBiometrica();
  }
}

function actualizarLecturaBiometrica() {
  console.log(`Estado: ${estadoConexion} | BPM: ${bpm || "--"} | A: ${inputA} ms | B: ${inputB} ms | RMSSD: ${rmssd.toFixed(1)} ms | Coherencia: ${factorSomatico.toFixed(2)}`);
  actualizarVisualizacionHRV();
}

// Inicialización de Event Listeners seguros con DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  const btnAccion = document.querySelector("#btn-accion-sesion");
  if (btnAccion) {
    btnAccion.addEventListener("click", iniciarEvaluacionBasal);
  } else {
    console.error("No se encontró el botón #btn-accion-sesion en el HTML.");
  }

  const botonConectar = document.querySelector("#btn-conectar");
  if (botonConectar) botonConectar.addEventListener("click", conectarSensorCardiaco);

  const botonCamara = document.querySelector("#btn-camara");
  if (botonCamara) {
    botonCamara.addEventListener("click", () => {
      if (camaraActiva) {
        detenerCamaraPPG();
      } else {
        iniciarCamaraPPG();
      }
    });
  }

  const botonExportarDirecto = document.querySelector("#btn-exportar-directo");
  if (botonExportarDirecto) botonExportarDirecto.addEventListener("click", exportarMuestreoCSV);

  const botonVerGrafico = document.querySelector("#btn-ver-grafico");
  if (botonVerGrafico) {
    botonVerGrafico.addEventListener("click", () => renderizarGraficoComparativo());
  }

  const botonVerGraficoSidebar = document.querySelector("#btn-ver-grafico-sidebar");
  if (botonVerGraficoSidebar) {
    botonVerGraficoSidebar.addEventListener("click", () => {
      const ultimoRegistro = registroHistorial.at(-1);
      if (ultimoRegistro) mostrarDashboardFinal(ultimoRegistro);
      else document.querySelector("#results-dialog")?.showModal();
      renderizarGraficoComparativo();
    });
  }

  const textosInformativos = {
    coherencia: ["Coherencia cardíaca", "Estado de sincronización fisiológica donde el ritmo cardíaco se vuelve una onda armónica y fluida."],
    rr: ["Intervalo RR", "El tiempo en milisegundos entre cada latido consecutivo del corazón."],
    resonancia: ["Frecuencia de resonancia · 0.1 Hz", "Ritmo óptimo de respiración, aproximadamente 6 respiraciones por minuto, que estimula el nervio vago y equilibra el sistema nervioso."],
    rmssd: ["RMSSD", "Métrica que refleja la actividad del sistema parasimpático y la capacidad de recuperación ante el estrés."],
  };

  const dialogoInfo = document.querySelector("#info-dialog");
  document.querySelectorAll("[data-info]").forEach((boton) => {
    boton.addEventListener("click", () => {
      const [titulo, texto] = textosInformativos[boton.dataset.info];
      const titleEl = document.querySelector("#info-title");
      const textEl = document.querySelector("#info-text");
      if (titleEl) titleEl.textContent = titulo;
      if (textEl) textEl.textContent = texto;
      dialogoInfo?.showModal();
    });
  });

  document.querySelector("#info-dialog .dialog-close")?.addEventListener("click", () => dialogoInfo?.close());
  document.querySelectorAll(".report-dialog .dialog-close").forEach((boton) => {
    boton.addEventListener("click", () => boton.closest("dialog")?.close());
  });

  // Se escucha el evento nativo "close" (no solo el clic en "Cerrar") para que
  // el reinicio de estado ocurra sin importar cómo se cierre el diálogo (Esc incluida)
  // y así nunca se quede la sesión bloqueada en la fase de resultados.
  document.querySelector("#results-dialog")?.addEventListener("close", () => {
    if (faseActual !== estadoFases.RESULTADOS) return;
    faseActual = estadoFases.ESPERA;
    document.querySelector("#session-hud")?.classList.add("hidden");
    document.querySelector("#phase-overlay")?.classList.add("hidden");
    intervalosRR.length = 0;
    intervalosRR.push(inputA, inputB);
    historialTacograma.length = 0;
    historialTacograma.push(inputA, inputB);
    rmssd = 0;
    siVisual = null;
    siFiltroInicializado = false;
    actualizarBotonesPhase();
    actualizarVisualizacionHRV();
  });

  // Inicialización de datos
  cargarHistorial();
  actualizarTendenciaBiometrica();
  actualizarEstadoBluetooth("Desconectado", false);
  actualizarLecturaBiometrica();

  // Iniciar bucle de render y animación
  generarCampo();
  animar();
});

// Bucle de render de Three.js ejecutándose continuamente
function animar() {
  requestAnimationFrame(animar);
  controlesOrbita.update();
  actualizarCampoAnimado();
  actualizarBotonesPhase();
  renderer.render(escena, camara);
}

function ajustarVentana() {
  if (!viewport) return;
  const ancho = viewport.clientWidth;
  const altura = viewport.clientHeight;
  camara.aspect = ancho / altura;
  camara.updateProjectionMatrix();
  renderer.setSize(ancho, altura);
}

window.addEventListener("resize", ajustarVentana);
window.addEventListener("resize", dibujarTacograma);