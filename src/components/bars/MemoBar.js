import {h, Component} from 'preact'
import classNames from 'classnames'

import i18n from '../../i18n.js'
import {noop} from '../../modules/helper.js'
import Bar from './Bar.js'

const t = i18n.context('MemoBar')

class MemoBar extends Component {
  constructor() {
    super()

    this.handleMemoButtonClick = this.handleMemoButtonClick.bind(this)
  }

  handleMemoButtonClick(evt) {
    let {onMemoButtonClick = noop} = this.props

    evt.tool = evt.currentTarget.dataset.id

    onMemoButtonClick(evt)
  }

  renderButton(title, toolId) {
    return h(
      'li',
      {class: classNames()},
      h(
        'a',
        {
          title,
          href: '#',
          'data-id': toolId,
          onClick: this.handleMemoButtonClick
        },

        h('img', {src: `./img/ui/${toolId}.svg`})
      )
    )
  }

  render({todo}) {
    return h(
      Bar,
      Object.assign({type: 'memo'}, this.props),

      h('div', {class: 'problems'}, t(`${todo}`)),
      h(
        'ul',
        {},
        [
          [t('Complete failure to recall the information'), 'memo_0'],
          [
            t(
              'Incorrect response, but upon seeing the correct answer it felt familiar'
            ),
            'memo_1'
          ],
          [
            t(
              'Incorrect response, but upon seeing the correct answer it seemed easy to remember'
            ),
            'memo_2'
          ],
          [
            t(
              'Correct response, but required significant difficulty to recall'
            ),
            'memo_3'
          ],
          [t('Correct response after some hesitation'), 'memo_4'],
          [t('Correct response with perfect recall'), 'memo_5']
        ].map(x => this.renderButton(...x))
      )
    )
  }
}

export default MemoBar
