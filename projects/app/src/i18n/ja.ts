/**
 * Japanese. See `de.ts` for how the keys work: `editor.actions.<id>` is keyed
 * by the library's action ids, and `keywords` are *added* to the English
 * ones — a Japanese writer finds 太字 by typing 太字, ふとじ or bold.
 *
 * The readings (ふとじ, みだし …) are there on purpose: an input method
 * shows hiragana until the writer converts, and the menu should already be
 * filtering by then.
 */
export default {
  app: {
    nav: { composer: '作成', api: 'API', styling: 'スタイル' },
    language: '言語',
    compose: '作成',
    theme: { light: 'ライトモードに切り替え', dark: 'ダークモードに切り替え' },
  },
  composeWindow: {
    new: '新規メッセージ',
    minimize: '最小化',
    restore: '元に戻す',
    expand: '全画面表示',
    collapse: '全画面表示を終了',
    close: '閉じる',
    sent: 'メッセージを送信しました',
  },
  editor: {
    actions: {
      text: { title: 'テキスト', keywords: '段落, 本文, だんらく' },
      'heading-1': { title: '見出し 1', keywords: '見出し, タイトル, みだし' },
      'heading-2': { title: '見出し 2', keywords: '見出し, タイトル, みだし' },
      'heading-3': { title: '見出し 3', keywords: '見出し, タイトル, みだし' },
      quote: { title: '引用', keywords: '引用, いんよう' },
      'bulleted-list': { title: '箇条書き', keywords: 'リスト, 箇条書き, かじょうがき' },
      'numbered-list': { title: '番号付きリスト', keywords: 'リスト, 番号, ばんごう' },
      image: { title: '画像', keywords: '画像, 写真, がぞう' },
      'image-placeholder': { title: '画像プレースホルダー', keywords: '画像, 枠, がぞう' },
      divider: { title: '区切り線', keywords: '線, 区切り, くぎり' },
      button: { title: 'ボタン', keywords: 'ボタン, ぼたん' },
      'button-link': { title: 'ボタンリンク', keywords: 'ボタン, リンク, ぼたん' },
      table: { title: '表', keywords: '表, テーブル, ひょう' },
      'bordered-table': { title: '罫線付きの表', keywords: '表, 罫線, けいせん' },
      columns: { title: '段組み', keywords: '列, カラム, だんぐみ' },
      '3-columns': { title: '3 段組み', keywords: '列, カラム, だんぐみ' },
      bold: { title: '太字', keywords: '太字, ふとじ, 強調' },
      italic: { title: '斜体', keywords: '斜体, しゃたい, イタリック' },
      underline: { title: '下線', keywords: '下線, かせん, アンダーライン' },
      strike: { title: '取り消し線', keywords: '取り消し線, とりけしせん' },
      'replace-image': { title: '画像を置き換え', keywords: '画像, 置き換え, 差し替え, がぞう' },
      'remove-image': { title: '画像を削除', keywords: '画像, 削除, がぞう' },
      'align-left': { title: '左揃え', keywords: '揃え, 左, ひだりそろえ' },
      'align-center': { title: '中央揃え', keywords: '揃え, 中央, ちゅうおうそろえ' },
      'align-right': { title: '右揃え', keywords: '揃え, 右, みぎそろえ' },
      indent: { title: 'インデントを増やす', keywords: 'インデント, 字下げ' },
      outdent: { title: 'インデントを減らす', keywords: 'インデント, 字上げ' },
      'clear-formatting': { title: '書式をクリア', keywords: '書式, クリア, しょしき' },
      send: { title: '送信', keywords: '送信, そうしん' },
      templates: {
        title: 'テンプレート',
        keywords: 'テンプレート, 定型文, てんぷれーと',
        placeholder: 'テンプレートを検索…',
      },
      ai: {
        title: 'AI: 文章を書く',
        keywords: 'AI, アシスタント, 続き, 下書き, メール, 提案, つづき',
      },
    },
    ai: {
      dialog: '文章アシスタント',
      preview: '提案された文章',
      instructions: '指示',
      prompt: 'アシスタントに変更してほしい点を伝えてください…',
      rewrite: 'この指示で書き直す',
      rewriteKey: 'Ctrl+Enter',
      accept: '承認して挿入',
    },
    toolbar: {
      'image-alt': '代替テキスト',
      color: '色',
      link: 'リンク',
      table: '表を挿入',
    },
    color: {
      text: '文字の色',
      background: '背景色',
      automatic: '自動',
      none: 'なし',
    },
    link: {
      dialog: 'リンクを編集',
      url: 'リンクの URL',
      apply: 'リンクを適用',
      open: 'リンクを開く',
      remove: 'リンクを削除',
    },
    button: {
      menu: 'ボタンのオプション',
      label: 'ボタンのテキスト',
    },
    image: {
      menu: '画像オプション',
      addAlt: '代替テキストを追加',
      altLabel: '代替テキスト',
      altPlaceholder: '画像の説明',
      altWithValue: '代替テキスト：{{alt}}',
      applyAlt: '代替テキストを適用',
    },
    menu: {
      slash: { label: 'ブロックを挿入', placeholder: '入力して絞り込み…' },
      tokens: { label: '差し込みフィールド', placeholder: 'フィールドを検索…' },
      loading: '検索中…',
      loadingMore: 'さらに読み込み中…',
      empty: '該当なし',
      error: '候補を読み込めませんでした',
      back: '戻る',
      results: { one: '1 件', other: '{{count}} 件' },
      selection: '選択範囲の書式',
    },
  },
};
