#!/usr/bin/env node

/**
 * 公众号文章同步工具
 * 
 * 功能：将 wechat-article-exporter 或其他来源导出的 HTML 转换为网站 Markdown 格式
 * 
 * 使用方法：
 * 1. 使用 wechat-article-exporter 导出公众号文章（HTML 格式）
 * 2. 将导出的 HTML 文件放入 tools/sync-wechat/input/ 目录
 * 3. 运行：npm run sync
 * 4. 检查输出：docs/xunkanglu/
 * 5. 提交代码，Vercel 自动部署
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertHTMLToMarkdown } from './convert.js';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 确保输入输出目录存在
function ensureDirs() {
  const dirs = [config.inputDir, config.outputDir];
  if (config.downloadImages) {
    dirs.push(config.assetsDir);
  }
  
  dirs.forEach(dir => {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`✅ 创建目录: ${dir}`);
    }
  });
}

// 获取输入目录中的 HTML 文件
function getHTMLFiles() {
  const inputPath = path.join(process.cwd(), config.inputDir);
  
  if (!fs.existsSync(inputPath)) {
    return [];
  }
  
  const files = fs.readdirSync(inputPath);
  return files.filter(f => f.endsWith('.html') || f.endsWith('.htm'));
}

// 从文件名提取日期（如果有）
function extractDateFromFilename(filename) {
  // 匹配 YYYY-MM-DD 格式
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  // 匹配 YYYYMMDD 格式
  const match2 = filename.match(/(\d{4})(\d{2})(\d{2})/);
  if (match2) {
    return `${match2[1]}-${match2[2]}-${match2[3]}`;
  }
  return new Date().toISOString().split('T')[0];
}

// 生成文章文件名
function generateFilename(title, date) {
  // 清理标题中的特殊字符
  const safeTitle = title
    .replace(/[^\w\s\u4e00-\u9fa5]/g, '')  // 保留中文、字母、数字、空格
    .replace(/\s+/g, '-')                   // 空格转连字符
    .substring(0, 50);                      // 限制长度
  
  return `${date}-${safeTitle}.md`;
}

// 同步主函数
async function sync() {
  console.log('🚀 开始同步公众号文章...\n');
  
  ensureDirs();
  
  const htmlFiles = getHTMLFiles();
  if (htmlFiles.length === 0) {
    console.log('⚠️  没有找到 HTML 文件');
    console.log('请将 wechat-article-exporter 导出的 HTML 文件放入: tools/sync-wechat/input/');
    console.log('\n使用 wechat-article-exporter:');
    console.log('1. 访问 https://wechat-article-exporter.dnomd343.top/');
    console.log('2. 登录你的公众号');
    console.log('3. 选择文章 → 导出为 HTML');
    console.log('4. 将导出的文件放入 input/ 目录');
    return;
  }
  
  console.log(`📄 找到 ${htmlFiles.length} 个 HTML 文件\n`);
  
  const results = [];
  
  for (const file of htmlFiles) {
    console.log(`📖 处理: ${file}`);
    
    try {
      const inputPath = path.join(process.cwd(), config.inputDir, file);
      const html = fs.readFileSync(inputPath, 'utf-8');
      
      // 转换为 Markdown
      const result = await convertHTMLToMarkdown(html, {
        title: file.replace(/\.(html|htm)$/, ''),
        date: extractDateFromFilename(file),
        author: config.author,
        tags: config.defaultTags,
        filename: file,
      });
      
      // 生成输出文件
      const filename = generateFilename(result.title, result.date);
      const outputPath = path.join(process.cwd(), config.outputDir, filename);
      
      // 生成 Markdown 内容
      const content = `---
title: "${result.title.replace(/"/g, '\\"')}"
date: ${result.date}
author: ${result.author}
source: "${config.wechatName}公众号"
tags: [${result.tags.join(', ')}]
---

${result.content}
`;
      
      // 写入文件
      fs.writeFileSync(outputPath, content, 'utf-8');
      console.log(`✅ 已保存: ${filename}\n`);
      
      results.push({ file, filename, success: true });
      
    } catch (error) {
      console.error(`❌ 处理失败: ${file}`);
      console.error(`   错误: ${error.message}\n`);
      results.push({ file, filename: null, success: false, error: error.message });
    }
  }
  
  // 生成统计
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;
  
  console.log('='.repeat(50));
  console.log('📊 同步完成');
  console.log(`✅ 成功: ${successCount} 篇`);
  console.log(`❌ 失败: ${failCount} 篇`);
  console.log(`📁 输出目录: ${config.outputDir}`);
  console.log('='.repeat(50));
  
  if (failCount > 0) {
    console.log('\n失败文件:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.file}: ${r.error}`);
    });
  }
}

// 更新板块首页（文章列表）
function updateIndex() {
  const outputPath = path.join(process.cwd(), config.outputDir);
  
  // 读取所有文章文件
  const files = fs.readdirSync(outputPath)
    .filter(f => f.endsWith('.md') && f !== 'index.md')
    .sort()
    .reverse();
  
  // 提取文章信息
  let articleList = files.map(file => {
    try {
      const content = fs.readFileSync(path.join(outputPath, file), 'utf-8');
      const titleMatch = content.match(/title:\s*"?(.*?)"?\n/);
      const dateMatch = content.match(/date:\s*(\d{4}-\d{2}-\d{2})/);
      const title = titleMatch ? titleMatch[1] : file.replace('.md', '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const date = dateMatch ? dateMatch[1] : '未知日期';
      return { title, date, file };
    } catch {
      return { title: file.replace('.md', ''), date: '未知', file };
    }
  });
  
  // 生成首页内容
  const indexContent = `# 寻康路

> 🌿 「${config.wechatName}」公众号精选文章存档

这里是「${config.wechatName}」微信公众号的内容存档，所有文章已转换为适合网站阅读的格式。

## 📖 文章列表（${articleList.length} 篇）

${articleList.length > 0 ? articleList.map(a => `- [${a.date}] [${a.title}](./${a.file})`).join('\n') : '_文章同步中，即将上线..._'}

---

> 💚 关注「${config.wechatName}」微信公众号获取更多健康养生内容
> 🔄 本板块通过自动化工具同步更新
`;

  // 写入首页
  const indexPath = path.join(process.cwd(), config.outputDir, 'index.md');
  fs.writeFileSync(indexPath, indexContent, 'utf-8');
  console.log('\n📋 板块首页已更新');
}

// 运行
sync().then(() => {
  updateIndex();
}).catch(error => {
  console.error('❌ 同步失败:', error);
  process.exit(1);
});
