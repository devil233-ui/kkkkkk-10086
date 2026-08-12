import globals from 'globals'
import neostandard from 'neostandard'

export default [{
  languageOptions: {
    globals: {
      ...globals.node
    },
  },
  files: ['apps/**/*.js', 'module/**/*.js'],
  rules: {
    ...(/** @type {any} */ (neostandard)).rules,
    // 禁用驼峰命名命名规则，允许使用下划线命名法。
    'camelcase': ['off'],
    // 禁用等号严格比较规则，允许使用==和!=进行比较。
    'eqeqeq': ['off'],
    // 禁用优先使用const声明变量的规则，允许使用let和var。
    'prefer-const': ['off'],
    // 要求对象属性的末尾不能有逗号，设置为错误等级1。
    'comma-dangle': [1, 'never'],
    // 禁用箭头函数体风格规则，允许使用任意风格。
    'arrow-body-style': 'off',
    // 格式由上游代码风格决定，避免同步时产生大规模纯格式差异。
    'indent': 'off',
    'space-before-function-paren': 'off',
    'semi': 'off',
    'no-trailing-spaces': 'off',
    // 要求对象字面量大括号内两侧必须有空格，设置为错误等级1。
    "object-curly-spacing": [1, 'always'],
  }
}]
