#!/usr/bin/env node
import fs from 'node:fs'
import ora from 'ora'
import sade from 'sade'
import chalk from 'chalk'
import * as cheerio from 'cheerio'

/** @type {ReturnType<typeof ora>} */
let spinner

sade('bdic <word>')
  .version(JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version)
  .describe('Get the definition of a word.')
  .example('hello')
  .example('-c world')
  .option('-c, --complete', 'Show complete definition')
  .option('-d, --dict', 'Dictionary (bing | youdao, default bing)')
  .action(searchWord)
  .parse(process.argv, { boolean: ['complete'] })

async function text(/** @type {Response} */ response) {
  if (!response.ok) {
    spinner?.stop()
    let message = await response.text()
    // The service returns an HTML page, parse useful contents
    if (message.startsWith('<!')) {
      const $ = cheerio.load(message)
      const sc_error = $('.sc_error').text()
      if (sc_error) message = sc_error
    }
    console.error(chalk.red(message || response.statusText))
    process.exit(1)
  }

  return response.text()
}

/**
 * @typedef {{ complete?: boolean, dict?: 'bing' | 'youdao' }} Options
 */

async function searchWord(/** @type {string} */ word, /** @type {Options} */ options = {}) {
  // Search
  spinner ||= ora('Loading\u2026')
  spinner.start()

  const constants = {
    BING: 'https://cn.bing.com/dict/clientsearch?mkt=zh-CN&setLang=zh&form=BDVEHC&ClientVer=BDDTV3.5.1.4320&q=',
    YOUDAO: 'https://dict.youdao.com/w/',
  }
  const { complete = false, dict = 'bing' } = options
  const result = {}

  // https://cn.bing.com/dict
  if (dict === 'bing') {
    const $ = await fetch(constants.BING + encodeURIComponent(word.replace(/\s+/g, ' ')))
      .then(text)
      .then(cheerio.load)

    if ($('.client_def_hd_hd').length > 0) {
      client_def_hd_hd($, result)
    } else if ($('.client_trans_head').length > 0) {
      client_trans_head($, result)
    } else if ($('.client_do_you_mean_title_bar').length > 0) {
      client_do_you_mean_title_bar($, result)
    }
  }

  // https://dict.youdao.com/
  else if (dict === 'youdao') {
    const $ = await fetch(constants.YOUDAO + encodeURIComponent(word.replace(/\s+/g, ' ')))
      .then(text)
      .then(cheerio.load)

    const typo = $('.error-typo')
    if (typo.length > 0) {
      result.list = typo.text()
    } else {
      handle_youdao($, result)
    }
  }

  // Render
  spinner.stop()

  if (!result.title) {
    console.log(chalk.red('No result.'))
    return
  }
  console.log()

  if (complete && result.phsym) {
    console.log(`    ${chalk.whiteBright.bold.underline(result.title)}  ${result.phsym}`)
    console.log()
  }

  if (complete && result.prons) {
    console.log(
      `    ${chalk.whiteBright.bold.underline(result.title)}  ${result.prons}` +
        (result.rank ? `  ${chalk.dim(`(${result.rank})`)}` : '') +
        (result.stars ? `  ${chalk.yellowBright('★'.repeat(result.stars))}` : ''),
    )
    console.log()
  }

  if (complete && result.infs) {
    console.log(`    ${chalk.cyanBright('词形')} ${chalk.whiteBright(result.infs)}`)
    console.log()
  }

  if (complete && result.pattern) {
    console.log(`    ${chalk.cyanBright('词形')} ${chalk.whiteBright(result.pattern)}`)
    console.log()
  }

  if (result.cdef) {
    result.cdef.each((i, a) => {
      console.log(`    ${chalk.cyanBright(a.pos)} ${chalk.whiteBright(a.def)}`)
    })
    console.log()
  }

  if (result.basic) {
    result.basic.each((i, a) => {
      console.log(`    ${chalk.whiteBright(a)}`)
    })
    console.log()
  }

  if (complete && result.sentences) {
    console.log(`    ${chalk.bgWhite.black(' 例句 ')}`)
    console.log()
    result.sentences.each((i, a) => {
      const num = chalk.whiteBright(i + 1 + '.')
      console.log(`    ${num} ${chalk.whiteBright(a.en)}   ${chalk.dim(`(${a.source})`)}`)
      console.log(`       ${chalk.white(a.chs)}`)
      console.log()
    })
  }

  if (complete && result.sentence) {
    console.log(`    ${chalk.bgWhite.black(' 例句 ')}`)
    console.log()
    result.sentence.each((i, a) => {
      const num = chalk.whiteBright(i + 1 + '.')
      console.log(`    ${num} ${chalk.whiteBright(a)}`)
      console.log()
    })
  }
}

function client_def_hd_hd(/** @type {cheerio.CheerioAPI} */ $, result) {
  result.title = $('.client_def_hd_hd').text()

  const prons = $('.client_def_hd_pn_list')
  if (prons.length > 0) {
    result.phsym = prons
      .map((i, el) => $(el).find('.client_def_hd_pn').text())
      .filter((i, e) => e)
      .toArray()
      .join('')
    if (result.phsym.length === 0) {
      delete result.phsym
    }
  }

  const defs = $('.client_def_container .client_def_bar')
  if (defs.length > 0) {
    result.cdef = defs
      .filter((i, el) => $(el).find('.client_def_list_word_Tag').length === 0)
      .map((i, el) => ({
        pos: $(el).find('.client_def_title_bar').text(),
        def: $(el).find('.client_def_list').text(),
      }))
      .filter((i, e) => e.pos && e.def)
    if (result.cdef.length === 0) {
      delete result.cdef
    }
  }

  const infs = $('.client_word_change_word')
  if (infs.length > 0) {
    result.infs = infs
      .map((i, el) => $(el).text().trim())
      .filter((i, e) => e)
      .toArray()
      .join(', ')
    if (result.infs.length === 0) {
      delete result.infs
    }
  }

  const sens = $('.client_sentence_list')
  if (sens.length > 0) {
    result.sentences = sens
      .map((i, el) => {
        $(el)
          .find('.client_sen_en_word, .client_sen_cn_word, .client_sen_word')
          .replaceWith((i, el) => $(el).text())
        $(el)
          .find('.client_sentence_search')
          .replaceWith((i, el) => chalk.cyan($(el).text()))
        return {
          en: $(el).find('.client_sen_en').html(),
          chs: $(el).find('.client_sen_cn').html(),
          source: $(el).find('.client_sentence_list_link').text(),
        }
      })
      .slice(0, 4)
  }

  return result
}

function client_trans_head(/** @type {cheerio.CheerioAPI} */ $, result) {
  result.mt = $('.client_sen_cn').text()
  return result
}

function client_do_you_mean_title_bar(/** @type {cheerio.CheerioAPI} */ $, result) {
  result.title = $('.client_do_you_mean_title_bar').text()
  result.defs = []

  $('.client_do_you_mean_area').each((i, area) => {
    const defs = $(area).find('.client_do_you_mean_list')
    if (defs.length > 0) {
      result.defs.push({
        title: $(area).find('.client_do_you_mean_title').text(),
        meanings: defs.map((i, el) => ({
          word: $(el).find('.client_do_you_mean_list_word').text(),
          def: $(el).find('.client_do_you_mean_list_def').text(),
        })),
      })
    }
  })

  return result
}

function handle_youdao(/** @type {cheerio.CheerioAPI} */ $, result) {
  result.title = $('.keyword').text()
  result.stars = ($('.star').attr('class')?.match(/\d+/) || [0])[0]
  result.rank = $('.rank').text()
  result.pattern = $('.pattern').text().replace(/\s+/g, ' ').trim()
  result.prons = $('.baav .pronounce')
    .map((i, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .filter((i, e) => e)
    .toArray()
    .join(' ')
  result.basic = $('#phrsListTab .trans-container li')
    .map((i, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .filter((i, e) => e)
  result.discrimination = $('#discriminate').text().replace(/\s+/g, ' ').trim()
  result.sentence = $('#authority .ol li').map((i, el) => {
    $(el)
      .find('b')
      .replaceWith((i, el) => chalk.cyan($(el).text()))
    const via = $(el).find('.example-via')
    const pos = chalk.dim(`(${via.text()})`)
    via.replaceWith('')
    return `${$(el).find('p').text().trim()}   ${pos}`
  })
  result.translation = $('#fanyiToggle .trans-container').text().replace(/\s+/g, ' ').trim()
  return result
}
