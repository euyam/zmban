import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

/**
 * 将公众号 HTML 转换为 Markdown
 * 支持 wechat-article-exporter 导出的格式
 * @param {string} html - 公众号 HTML 内容
 * @param {Object} meta - 元数据（title, date, author, tags）
 * @returns {Object} - { title, date, content }
 */
export async function convertHTMLToMarkdown(html, meta = {}) {
  const $ = cheerio.load(html);
  
  // 提取标题（多种方式尝试）
  let title = meta.title || '未命名文章';
  
  // 方式1: 从 h1 标签
  const h1 = $('h1').first();
  if (h1.length) {
    title = h1.text().trim();
  }
  // 方式2: 从 title 标签
  else {
    const titleTag = $('title').first();
    if (titleTag.length) {
      title = titleTag.text().trim();
    }
  }
  
  // 方式3: 从文件名提取（如果 title 还是默认值）
  if (title === '未命名文章' && meta.filename) {
    title = meta.filename.replace(/\.(html|htm)$/, '').replace(/[_-]/g, ' ');
  }
  
  // 提取正文
  let content = '';
  
  // wechat-article-exporter 通常保留完整的文章结构
  // 尝试多种选择器找到正文内容
  const selectors = [
    '#js_content',           // 微信标准
    '.rich_media_content',   // 微信标准
    'article',               // 语义化标签
    '.content',              // 通用
    'body',                  // 最后手段
  ];
  
  let mainContent = null;
  for (const selector of selectors) {
    mainContent = $(selector).first();
    if (mainContent.length && mainContent.text().trim().length > 50) {
      break;
    }
  }
  
  if (mainContent && mainContent.length) {
    content = htmlToMarkdown($, mainContent);
  } else {
    // 如果都没找到，转换整个 body
    content = htmlToMarkdown($, $('body'));
  }
  
  // 清理多余空行
  content = content.replace(/\n{3,}/g, '\n\n').trim();
  
  // 清理前后多余的空白字符
  content = content.replace(/^[\s\n]+|[\s\n]+$/g, '');
  
  return {
    title,
    date: meta.date || new Date().toISOString().split('T')[0],
    author: meta.author || '寻康路',
    tags: meta.tags || ['健康', '养生'],
    content,
  };
}

/**
 * 将 HTML 元素转换为 Markdown
 */
function htmlToMarkdown($, element) {
  let md = '';
  
  element.children().each((_, child) => {
    const node = $(child);
    const tag = child.tagName?.toLowerCase();
    
    switch (tag) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        const level = parseInt(tag[1]) || 2;
        const prefix = '#'.repeat(level);
        const headingText = node.text().trim();
        if (headingText) {
          md += `\n\n${prefix} ${headingText}\n\n`;
        }
        break;
        
      case 'p':
        const pText = processInlineElements($, node);
        if (pText.trim()) {
          md += `\n\n${pText.trim()}\n\n`;
        }
        break;
        
      case 'img':
        const src = node.attr('data-src') || node.attr('src') || '';
        const alt = node.attr('alt') || '';
        if (src && !src.startsWith('data:')) {
          md += `\n\n![${alt}](${src})\n\n`;
        }
        break;
        
      case 'br':
        md += '\n';
        break;
        
      case 'strong':
      case 'b':
        md += `**${node.text()}**`;
        break;
        
      case 'em':
      case 'i':
        md += `*${node.text()}*`;
        break;
        
      case 'ul':
      case 'ol':
        const isOrdered = tag === 'ol';
        let index = 1;
        md += '\n\n';
        node.children().each((_, li) => {
          const liNode = $(li);
          if (liNode.is('li')) {
            const prefix = isOrdered ? `${index}.` : '-';
            md += `${prefix} ${liNode.text().trim()}\n`;
            index++;
          }
        });
        md += '\n\n';
        break;
        
      case 'blockquote':
        const quoteText = node.text().trim();
        if (quoteText) {
          md += `\n\n> ${quoteText.replace(/\n/g, '\n> ')}\n\n`;
        }
        break;
        
      case 'section':
      case 'div':
      case 'span':
        // 检查是否有特殊样式需要保留
        const style = node.attr('style') || '';
        
        // 如果是微信的 section，递归处理子元素
        if (node.children().length > 0) {
          md += htmlToMarkdown($, node);
        } else {
          const text = node.text().trim();
          if (text) {
            md += text;
          }
        }
        break;
        
      case 'a':
        const href = node.attr('href') || '';
        const linkText = node.text().trim();
        if (href && linkText) {
          md += `[${linkText}](${href})`;
        } else if (linkText) {
          md += linkText;
        }
        break;
        
      case 'table':
        md += '\n\n' + convertTableToMarkdown($, node) + '\n\n';
        break;
        
      case 'code':
        const codeText = node.text();
        if (node.parent().is('pre')) {
          // 代码块
          md += `\n\n\`\`\`\n${codeText}\n\`\`\`\n\n`;
        } else {
          // 行内代码
          md += `\`${codeText}\``;
        }
        break;
        
      case 'pre':
        // 已经在 code 中处理
        break;
        
      case 'hr':
        md += '\n\n---\n\n';
        break;
        
      default:
        // 其他标签，递归处理子元素
        if (node.children().length > 0) {
          md += htmlToMarkdown($, node);
        } else {
          const text = node.text().trim();
          if (text) {
            md += text;
          }
        }
    }
  });
  
  return md;
}

/**
 * 处理行内元素（加粗、斜体、链接等）
 */
function processInlineElements($, node) {
  let result = '';
  
  node.contents().each((_, child) => {
    if (child.type === 'text') {
      result += $(child).text();
    } else if (child.type === 'tag') {
      const tag = child.tagName?.toLowerCase();
      const childNode = $(child);
      
      switch (tag) {
        case 'strong':
        case 'b':
          result += `**${childNode.text()}**`;
          break;
        case 'em':
        case 'i':
          result += `*${childNode.text()}*`;
          break;
        case 'a':
          const href = childNode.attr('href') || '';
          const text = childNode.text().trim();
          if (href && text) {
            result += `[${text}](${href})`;
          } else {
            result += text;
          }
          break;
        case 'img':
          const src = childNode.attr('data-src') || childNode.attr('src') || '';
          const alt = childNode.attr('alt') || '';
          if (src && !src.startsWith('data:')) {
            result += `![${alt}](${src})`;
          }
          break;
        case 'br':
          result += '\n';
          break;
        case 'span':
          result += processInlineElements($, childNode);
          break;
        default:
          result += childNode.text();
      }
    }
  });
  
  return result;
}

/**
 * 将 HTML 表格转换为 Markdown 表格
 */
function convertTableToMarkdown($, table) {
  let md = '';
  let headerRow = true;
  
  table.find('tr').each((_, tr) => {
    const row = $(tr);
    const cells = [];
    
    row.find('th, td').each((_, cell) => {
      cells.push($(cell).text().trim());
    });
    
    if (cells.length > 0) {
      md += '| ' + cells.join(' | ') + ' |\n';
      
      if (headerRow) {
        md += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        headerRow = false;
      }
    }
  });
  
  return md;
}
