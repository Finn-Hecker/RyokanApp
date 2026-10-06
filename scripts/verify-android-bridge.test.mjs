import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBridgeRetained, customBridgeMethods } from './verify-android-bridge.mjs';

const methods = [{ name: 'writeExportDocument', signature: '(Ljava/lang/String;[B)V' }];
const dump = (name = methods[0].name, signature = methods[0].signature, access = 'PUBLIC FINAL', owner = 'Lio/ryokan/app/MainActivity;') => `Class #0 -
  Class descriptor  : '${owner}'
  Virtual methods -
    #0 : (in ${owner})
      name          : '${name}'
      type          : '${signature}'
      access        : 0x0011 (${access})
Class #1 -
  Class descriptor  : 'Lunrelated/Class;'
`;

test('APK check requires the exact public instance definition in MainActivity', () => {
  assert.doesNotThrow(() => assertBridgeRetained([dump()], methods));
  for (const invalid of [dump('a'), dump(undefined, '()V'), dump(undefined, undefined, 'PUBLIC STATIC'),
    dump(undefined, undefined, 'PRIVATE'), dump(undefined, undefined, undefined, 'Lother/Activity;'), '']) {
    assert.throws(() => assertBridgeRetained([invalid], methods));
  }
});

test('discovers future custom JNI bridges while excluding inherited framework methods', () => {
  const rust = `env.call_method(activity, "writeExportDocument", "(Ljava/lang/String;[B)V", &[])?;
    env.call_method(activity, "finish", "()V", &[])?;
    env.call_method(activity, "nextBridge", "(I)V", &[])?;`;
  assert.deepEqual(customBridgeMethods(rust, 'fun writeExportDocument(uri: String, bytes: ByteArray) {}\nfun nextBridge(value: Int) {}'),
    [...methods, { name: 'nextBridge', signature: '(I)V' }]);
});
