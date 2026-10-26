import assert from 'node:assert/strict';
import {
  resolveSpeechLanguage,
  describeRecognitionError
} from '../src/services/speechService';

// Windows/Edge en español suele reportar "es" o "es-419". Azure Speech no
// acepta esos locales sin región y el reconocimiento falla en silencio.
assert.equal(resolveSpeechLanguage('es'), 'es-MX');
assert.equal(resolveSpeechLanguage('es-419'), 'es-MX');
assert.equal(resolveSpeechLanguage('es_419'), 'es-MX');
assert.equal(resolveSpeechLanguage('es-LA'), 'es-MX');
assert.equal(resolveSpeechLanguage('es-005'), 'es-MX');

// Variantes regionales que Azure sí soporta se conservan.
assert.equal(resolveSpeechLanguage('es-MX'), 'es-MX');
assert.equal(resolveSpeechLanguage('es-ES'), 'es-ES');
assert.equal(resolveSpeechLanguage('es-AR'), 'es-AR');
assert.equal(resolveSpeechLanguage('es-US'), 'es-US');

// Una variante inventada/no soportada cae a es-MX, nunca a "es" pelado.
assert.equal(resolveSpeechLanguage('es-XX'), 'es-MX');

// Otros idiomas no se tocan.
assert.equal(resolveSpeechLanguage('en-US'), 'en-US');
assert.equal(resolveSpeechLanguage('pt-BR'), 'pt-BR');
assert.equal(resolveSpeechLanguage(null), 'es-MX');

// Los errores deben llegar al usuario con una explicación útil.
assert.match(describeRecognitionError('audio-capture'), /micrófono activo/i);
assert.match(describeRecognitionError('not-allowed'), /bloqueó el micrófono/i);
assert.match(describeRecognitionError('language-not-supported'), /dialecto compatible/i);
assert.match(describeRecognitionError('network'), /servicio de reconocimiento/i);

console.log('✓ Idioma de voz: 14 comprobaciones OK');
