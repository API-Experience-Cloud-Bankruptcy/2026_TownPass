import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';

import 'package:crypto/crypto.dart';
import 'package:flutter_edge_ai/flutter_edge_ai.dart';
import 'package:flutter_edge_ai_litertlm/flutter_edge_ai_litertlm.dart';
import 'package:path_provider/path_provider.dart';

import 'llm_interpretation.dart';
export 'llm_interpretation.dart';

/// Original instruction-tuned model, without any TownPass training adapter.
class LocalLlmService {
  static final instance = LocalLlmService();
  static const revision = '3d48132a00cf76de57d926de30f5c5c5ed9b8c0d';
  static const filename = 'gemma-4-E2B-it.litertlm';
  static const modelBytes = 2588147712;
  static const modelSha256 =
      '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c';
  static const modelUrl =
      'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/$revision/$filename';

  String _state = 'not_downloaded';
  String? _message;
  int _downloaded = 0;
  InferenceModel? _model;
  Future<void>? _preparing;
  bool _busy = false;
  Map<String, Object?> get status => {
    'state': _state,
    'model': 'Gemma 4 E2B',
    'revision': revision,
    'progress': _downloaded / modelBytes,
    'downloadedBytes': _downloaded,
    'totalBytes': modelBytes,
    if (_message != null) 'message': _message,
  };

  Future<void> inspectCache() async {
    if (_state != 'not_downloaded' || _preparing != null) return;
    final support = await getApplicationSupportDirectory();
    final file = File('${support.path}/models/$revision/$filename');
    if (await file.exists() && await file.length() == modelBytes) {
      _downloaded = modelBytes;
      _state = 'downloaded';
    }
  }

  Future<void> prepare() {
    if (_model != null) return Future.value();
    return _preparing ??= _prepare().whenComplete(() => _preparing = null);
  }

  Future<void> _prepare() async {
    try {
      if (!Platform.isIOS && !Platform.isAndroid) {
        throw UnsupportedError('請在 iPhone 或 Android App 使用裝置端模型');
      }
      _message = null;
      final support = await getApplicationSupportDirectory();
      final directory = await Directory('${support.path}/models/$revision')
          .create(recursive: true);
      final file = File('${directory.path}/$filename');
      if (!await file.exists()) await _download(file);
      _state = 'loading';
      _message = '正在校驗模型與載入裝置端引擎';
      _downloaded = await file.length();
      final path = file.path;
      final digest = await Isolate.run(
        () async => (await sha256.bind(File(path).openRead()).first).toString(),
      );
      if (_downloaded != modelBytes || digest != modelSha256) {
        // Preserve the invalid file for diagnosis; retry never treats it as installed.
        await file.rename(
          '${file.path}.invalid-${DateTime.now().millisecondsSinceEpoch}',
        );
        throw const FormatException('模型校驗失敗，請重試下載');
      }
      await FlutterEdgeAi.initialize(inferenceEngines: [LiteRtLmEngine()]);
      await FlutterEdgeAi.installModel(
        modelType: ModelType.gemma4,
        fileType: ModelFileType.litertlm,
      ).fromFile(file.path).install();
      _model = await FlutterEdgeAi.getActiveModel(
        maxTokens: 4096,
        preferredBackend: PreferredBackend.gpu,
        supportImage: false,
        supportAudio: false,
        maxConcurrentSessions: 1,
      );
      _state = 'ready';
      _message = null;
    } catch (error) {
      _state = 'error';
      _message = switch (error) {
        SocketException() ||
        TimeoutException() ||
        HttpException() => '模型下載中斷，請確認網路後重試；已下載部分會保留。',
        FileSystemException() => '無法儲存模型，請確認手機可用空間後重試。',
        FormatException() => '模型完整性檢查未通過，請重試下載。',
        UnsupportedError() => '此功能需要 iPhone 或 Android App。',
        _ => '裝置端引擎載入失敗，請關閉其他 App 後重試。',
      };
      rethrow;
    }
  }

  Future<void> _download(File target) async {
    _state = 'downloading';
    final partial = File('${target.path}.part');
    var offset = await partial.exists() ? await partial.length() : 0;
    if (offset > modelBytes) {
      await partial.rename(
        '${partial.path}.invalid-${DateTime.now().millisecondsSinceEpoch}',
      );
      offset = 0;
    }
    if (offset == modelBytes) {
      _downloaded = offset;
      await partial.rename(target.path);
      return; // _prepare still verifies the full SHA-256 before loading.
    }
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 30);
    IOSink? sink;
    try {
      final request = await client.getUrl(Uri.parse(modelUrl));
      request.headers.set(HttpHeaders.acceptEncodingHeader, 'identity');
      if (offset > 0) {
        request.headers.set(HttpHeaders.rangeHeader, 'bytes=$offset-');
      }
      final response = await request.close().timeout(
        const Duration(seconds: 60),
      );
      if (response.statusCode == 200) offset = 0;
      if (response.statusCode != 200 && response.statusCode != 206) {
        throw HttpException('模型下載失敗（${response.statusCode}）');
      }
      if (response.statusCode == 206 &&
          !(response.headers.value(HttpHeaders.contentRangeHeader) ?? '')
              .startsWith('bytes $offset-')) {
        throw const FormatException('下載續傳範圍不符');
      }
      _downloaded = offset;
      sink = partial.openWrite(
        mode: offset > 0 ? FileMode.append : FileMode.write,
      );
      var buffered = 0;
      await for (final bytes in response.timeout(const Duration(seconds: 90))) {
        _downloaded += bytes.length;
        if (_downloaded > modelBytes) throw const FormatException('模型大小不符');
        sink.add(bytes);
        buffered += bytes.length;
        if (buffered >= 4 * 1024 * 1024) {
          await sink.flush();
          buffered = 0;
        }
      }
      await sink.flush();
      await sink.close();
      sink = null;
      if (_downloaded != modelBytes) throw const FormatException('模型下載不完整');
      await partial.rename(target.path);
    } finally {
      await sink?.close();
      client.close(force: true);
    }
  }

  Future<Map<String, Object?>> interpret(
    Map<String, dynamic> request, {
    void Function(String)? onRawText,
  }) async {
    if (_busy) throw StateError('busy');
    _busy = true;
    try {
      if (_model == null) throw StateError('model_not_ready');
      final direct = directBackgroundInterpretation(request);
      if (direct != null) return direct;
      final definitions = interpretationTools(request);
      for (var attempt = 0; attempt < 2; attempt++) {
        // Each request and format retry owns a fresh session. The supplied context
        // is the only conversation state; old model guesses never become facts.
        final instruction = interpretationInstructionForAttempt(attempt);
        final chat = await _model!.createChat(
          temperature: 0,
          topK: 1,
          topP: 1,
          randomSeed: 42,
          enableThinking: false,
          maxOutputTokens: 768,
          systemInstruction: instruction,
          tools: definitions
              .map(
                (t) => Tool(
                  name: t['name'] as String,
                  description: t['description'] as String,
                  parameters: t['parameters'] as Map<String, dynamic>,
                ),
              )
              .toList(),
          supportsFunctionCalls: true,
          toolChoice: ToolChoice.required,
        );
        try {
          var payload = jsonEncode(buildModelRequest(request));
          final instructionTokens =
              await chat.session.sizeInTokens(instruction) +
              await chat.session.sizeInTokens(jsonEncode(definitions));
          if (instructionTokens + await chat.session.sizeInTokens(payload) >
              3000) {
            payload = jsonEncode(buildModelRequest(request, minimal: true));
          }
          if (instructionTokens + await chat.session.sizeInTokens(payload) >
              3000) {
            throw const LlmInputTooLongException();
          }
          await chat.addQueryChunk(Message.text(text: payload, isUser: true));
          final response = await chat.generateChatResponse();
          try {
            final call = response is FunctionCallResponse
                ? response
                : response is ParallelFunctionCallResponse &&
                      response.calls.length == 1
                ? response.calls.single
                : null;
            onRawText?.call(
              call == null
                  ? response.toString()
                  : jsonEncode({'name': call.name, 'args': call.args}),
            );
            if (call == null && response is TextResponse) {
              return parseTextControl(response.token, request);
            }
            if (call == null) {
              throw const FormatException('expected_one_interpretation_tool');
            }
            return parseToolInterpretation(call.name, call.args, request);
          } on FormatException {
            if (attempt == 1) rethrow;
          }
        } finally {
          await chat.close();
        }
      }
      throw const FormatException('invalid_model_output');
    } finally {
      _busy = false;
    }
  }
}
