'use client';

import React, { useState, useRef } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import * as XLSX from 'xlsx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { UploadCloud, FileText, CheckCircle, AlertTriangle, Download, FileSpreadsheet, File as FileIcon, Loader2, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface ComparisonItem {
  item_name: string;
  required_description: string;
  required_quantity: number;
  offered_description: string;
  offered_quantity: number;
  offered_model?: string;
  model_verification_notes?: string;
  quantity_match: boolean;
  specification_match: boolean;
  discrepancy_details?: string;
  quotation_page_number: number;
}

interface EvaluationResult {
  comparisons: ComparisonItem[];
  general_comments: string;
}

// --- Helper Functions ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = error => reject(error);
  });
};

export default function QuotationEvaluator() {
  const [basisFile, setBasisFile] = useState<File | null>(null);
  const [quotationFile, setQuotationFile] = useState<File | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const basisInputRef = useRef<HTMLInputElement>(null);
  const quotationInputRef = useRef<HTMLInputElement>(null);

  const handleEvaluate = async () => {
    if (!basisFile || !quotationFile) {
      setError('Please upload both the Basis of Checking and the Vendor Quotation.');
      return;
    }

    setIsEvaluating(true);
    setError(null);
    setResult(null);

    try {
      setProgressMessage('Reading files...');
      
      let basisPart: any;
      if (basisFile.name.match(/\.(xlsx|xls|csv)$/i)) {
        const arrayBuffer = await basisFile.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer);
        let csvContent = '';
        workbook.SheetNames.forEach(sheetName => {
          csvContent += `--- Sheet: ${sheetName} ---\n`;
          csvContent += XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
          csvContent += '\n\n';
        });
        basisPart = { text: `DOCUMENT 1 (Basis of Checking / BOQ) Content:\n${csvContent}` };
      } else {
        const basisBase64 = await fileToBase64(basisFile);
        basisPart = {
          inlineData: {
            data: basisBase64,
            mimeType: basisFile.type || 'application/pdf',
          }
        };
      }

      const quotationBase64 = await fileToBase64(quotationFile);

      setProgressMessage('Analyzing documents with Gemini 3.1 Pro Preview...');
      
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      
      const parts = [
        basisPart,
        {
          text: "DOCUMENT 1: This is the Basis of Checking (Requirements / Bill of Quantities)."
        },
        {
          inlineData: {
            data: quotationBase64,
            mimeType: quotationFile.type || 'application/pdf',
          }
        },
        {
          text: "DOCUMENT 2: This is the Vendor Quotation Offer."
        },
        {
          text: `You are an expert procurement engineer. Your task is to meticulously compare the Vendor Quotation (DOCUMENT 2) against the Basis of Checking (DOCUMENT 1).
          
          Instructions:
          1. Extract all required items from the Basis of Checking.
          2. Extract the corresponding offered items from the Vendor Quotation.
          3. Compare their descriptions, quantities, and models.
          4. Use Google Search to verify the offered models to ensure they meet the requirements and understand their context.
          5. Be extremely meticulous about quantities. Flag any discrepancies.
          6. For each item, identify the page number in the Vendor Quotation where it is found (1-indexed).
          7. Provide a structured JSON output with the comparisons and general comments.`
        }
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: { parts },
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              comparisons: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    item_name: { type: Type.STRING },
                    required_description: { type: Type.STRING },
                    required_quantity: { type: Type.NUMBER },
                    offered_description: { type: Type.STRING },
                    offered_quantity: { type: Type.NUMBER },
                    offered_model: { type: Type.STRING },
                    model_verification_notes: { type: Type.STRING },
                    quantity_match: { type: Type.BOOLEAN },
                    specification_match: { type: Type.BOOLEAN },
                    discrepancy_details: { type: Type.STRING },
                    quotation_page_number: { type: Type.INTEGER }
                  },
                  required: ["item_name", "required_description", "required_quantity", "offered_description", "offered_quantity", "quantity_match", "specification_match", "quotation_page_number"]
                }
              },
              general_comments: { type: Type.STRING }
            },
            required: ["comparisons", "general_comments"]
          }
        }
      });

      setProgressMessage('Processing results...');
      const jsonStr = response.text;
      if (!jsonStr) throw new Error("No response from AI");
      
      const parsedResult = JSON.parse(jsonStr) as EvaluationResult;
      setResult(parsedResult);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during evaluation.');
    } finally {
      setIsEvaluating(false);
      setProgressMessage('');
    }
  };

  const downloadExcel = () => {
    if (!result) return;
    
    // Flatten the data for Excel
    const excelData = result.comparisons.map(item => ({
      'Item Name': item.item_name,
      'Required Description': item.required_description,
      'Required Qty': item.required_quantity,
      'Offered Description': item.offered_description,
      'Offered Qty': item.offered_quantity,
      'Offered Model': item.offered_model || 'N/A',
      'Qty Match': item.quantity_match ? 'Yes' : 'No',
      'Spec Match': item.specification_match ? 'Yes' : 'No',
      'Discrepancy Details': item.discrepancy_details || 'None',
      'Model Verification (Google Search)': item.model_verification_notes || 'N/A',
      'Quotation Page': item.quotation_page_number
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    
    // Auto-size columns roughly
    const colWidths = [
      { wch: 20 }, { wch: 40 }, { wch: 12 }, { wch: 40 }, { wch: 12 },
      { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 40 }, { wch: 50 }, { wch: 15 }
    ];
    worksheet['!cols'] = colWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Evaluation");
    
    // Generate filename based on quotation file
    const baseName = quotationFile ? quotationFile.name.replace(/\.[^/.]+$/, "") : "Quotation";
    XLSX.writeFile(workbook, `${baseName}_Evaluation_Report.xlsx`);
  };

  const downloadMarkedUpPdf = async () => {
    if (!result || !quotationFile) return;

    try {
      const arrayBuffer = await quotationFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      
      // Embed fonts
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const pages = pdfDoc.getPages();

      // 1. Add Summary Page at the beginning
      const summaryPage = pdfDoc.insertPage(0);
      const { width, height } = summaryPage.getSize();
      
      summaryPage.drawText('Quotation Evaluation Summary', {
        x: 50,
        y: height - 60,
        size: 24,
        font: helveticaBold,
        color: rgb(0.1, 0.1, 0.1),
      });

      // Wrap text for general comments
      const wrapText = (text: string, maxWidth: number, font: any, fontSize: number) => {
        const cleanText = text.replace(/\n/g, ' ').replace(/\r/g, '');
        const words = cleanText.split(' ');
        let lines: string[] = [];
        let currentLine = words[0] || '';

        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const width = font.widthOfTextAtSize(currentLine + " " + word, fontSize);
          if (width < maxWidth) {
            currentLine += " " + word;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) {
          lines.push(currentLine);
        }
        return lines;
      };

      let yOffset = height - 120;
      const commentLines = wrapText(result.general_comments, width - 100, helveticaFont, 12);
      
      commentLines.forEach(line => {
        summaryPage.drawText(line, {
          x: 50,
          y: yOffset,
          size: 12,
          font: helveticaFont,
          color: rgb(0.2, 0.2, 0.2),
        });
        yOffset -= 18;
      });

      yOffset -= 30;
      
      // Count discrepancies
      const discrepancies = result.comparisons.filter(c => !c.quantity_match || !c.specification_match);
      
      summaryPage.drawText(`Total Items Checked: ${result.comparisons.length}`, {
        x: 50, y: yOffset, size: 14, font: helveticaBold, color: rgb(0.1, 0.1, 0.1)
      });
      yOffset -= 25;
      summaryPage.drawText(`Discrepancies Found: ${discrepancies.length}`, {
        x: 50, y: yOffset, size: 14, font: helveticaBold, color: discrepancies.length > 0 ? rgb(0.8, 0.1, 0.1) : rgb(0.1, 0.6, 0.1)
      });

      // 2. Add Annotations to original pages
      // Keep track of y-offsets for each page to avoid overlapping annotations
      const pageOffsets: Record<number, number> = {};

      discrepancies.forEach(comp => {
        const originalPageNum = comp.quotation_page_number;
        // The new page index is originalPageNum because we inserted a page at index 0.
        // So original page 1 is now at index 1.
        if (originalPageNum > 0 && originalPageNum <= pages.length) {
          const pageIndex = originalPageNum;
          const page = pdfDoc.getPage(pageIndex);
          const { height: pageHeight } = page.getSize();
          
          if (!pageOffsets[pageIndex]) {
            pageOffsets[pageIndex] = pageHeight - 30;
          }

          const cleanDiscrepancy = (comp.discrepancy_details || 'Check specs/qty').replace(/\n/g, ' ').replace(/\r/g, '');
          const cleanItemName = comp.item_name.replace(/\n/g, ' ').replace(/\r/g, '');
          const text = `! DISCREPANCY: ${cleanItemName} - ${cleanDiscrepancy}`;
          
          // Draw a semi-transparent red background for the text
          const textWidth = helveticaBold.widthOfTextAtSize(text, 10);
          page.drawRectangle({
            x: 10,
            y: pageOffsets[pageIndex] - 2,
            width: Math.min(textWidth + 10, width - 20),
            height: 14,
            color: rgb(1, 0.9, 0.9),
            opacity: 0.8,
          });

          page.drawText(text.substring(0, 100) + (text.length > 100 ? '...' : ''), {
            x: 15,
            y: pageOffsets[pageIndex],
            size: 10,
            font: helveticaBold,
            color: rgb(0.8, 0.1, 0.1),
          });
          
          pageOffsets[pageIndex] -= 20;
        }
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Generate filename based on quotation file
      const baseName = quotationFile.name.replace(/\.[^/.]+$/, "");
      a.download = `${baseName}_Evaluated.pdf`;
      
      a.click();
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error("Error generating PDF:", err);
      alert("Failed to generate marked-up PDF.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] text-slate-900 font-sans p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900">
            Vendor Quotation Evaluator
          </h1>
          <p className="text-slate-500 max-w-2xl">
            Upload your requirements and the vendor&apos;s quotation. Our AI will meticulously compare quantities, verify models via Google Search, and highlight discrepancies.
          </p>
        </header>

        {/* Upload Section */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Basis of Checking */}
          <div 
            className={`relative p-8 rounded-2xl border-2 border-dashed transition-colors ${basisFile ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                setBasisFile(e.dataTransfer.files[0]);
              }
            }}
          >
            <input 
              type="file" 
              className="hidden" 
              ref={basisInputRef}
              onChange={(e) => e.target.files && setBasisFile(e.target.files[0])}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            />
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div className={`p-4 rounded-full ${basisFile ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                {basisFile ? <CheckCircle className="w-8 h-8" /> : <FileText className="w-8 h-8" />}
              </div>
              <div>
                <h3 className="font-medium text-slate-900">Basis of Checking</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {basisFile ? basisFile.name : 'Upload Requirements / BOQ (PDF, Excel, Word)'}
                </p>
              </div>
              {!basisFile && (
                <button 
                  onClick={() => basisInputRef.current?.click()}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  Browse Files
                </button>
              )}
              {basisFile && (
                <button 
                  onClick={() => setBasisFile(null)}
                  className="text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          {/* Vendor Quotation */}
          <div 
            className={`relative p-8 rounded-2xl border-2 border-dashed transition-colors ${quotationFile ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-300 bg-white hover:border-slate-400'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                setQuotationFile(e.dataTransfer.files[0]);
              }
            }}
          >
            <input 
              type="file" 
              className="hidden" 
              ref={quotationInputRef}
              onChange={(e) => e.target.files && setQuotationFile(e.target.files[0])}
              accept=".pdf"
            />
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div className={`p-4 rounded-full ${quotationFile ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                {quotationFile ? <CheckCircle className="w-8 h-8" /> : <UploadCloud className="w-8 h-8" />}
              </div>
              <div>
                <h3 className="font-medium text-slate-900">Vendor Quotation</h3>
                <p className="text-sm text-slate-500 mt-1">
                  {quotationFile ? quotationFile.name : 'Upload Vendor Offer (PDF only)'}
                </p>
              </div>
              {!quotationFile && (
                <button 
                  onClick={() => quotationInputRef.current?.click()}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  Browse Files
                </button>
              )}
              {quotationFile && (
                <button 
                  onClick={() => setQuotationFile(null)}
                  className="text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex flex-col items-center">
          <button
            onClick={handleEvaluate}
            disabled={!basisFile || !quotationFile || isEvaluating}
            className="px-8 py-4 bg-slate-900 text-white rounded-xl font-medium shadow-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center space-x-2"
          >
            {isEvaluating ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{progressMessage}</span>
              </>
            ) : (
              <>
                <Search className="w-5 h-5" />
                <span>Evaluate Quotation</span>
              </>
            )}
          </button>
          
          {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-600 rounded-lg flex items-start space-x-2 max-w-2xl w-full">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Results Section */}
        <AnimatePresence>
          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <h2 className="text-2xl font-semibold text-slate-900">Evaluation Results</h2>
                <div className="flex items-center space-x-3">
                  <button 
                    onClick={downloadExcel}
                    className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span>Export Excel</span>
                  </button>
                  <button 
                    onClick={downloadMarkedUpPdf}
                    className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
                  >
                    <FileIcon className="w-4 h-4 text-indigo-600" />
                    <span>Download Marked-up PDF</span>
                  </button>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Total Items</p>
                  <p className="text-3xl font-light text-slate-900 mt-2">{result.comparisons.length}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Perfect Matches</p>
                  <p className="text-3xl font-light text-emerald-600 mt-2">
                    {result.comparisons.filter(c => c.quantity_match && c.specification_match).length}
                  </p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">Discrepancies</p>
                  <p className="text-3xl font-light text-red-600 mt-2">
                    {result.comparisons.filter(c => !c.quantity_match || !c.specification_match).length}
                  </p>
                </div>
              </div>

              {/* General Comments */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h3 className="text-lg font-medium text-slate-900 mb-2">AI Summary & Context</h3>
                <p className="text-slate-600 leading-relaxed">{result.general_comments}</p>
              </div>

              {/* Detailed Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-medium">
                      <tr>
                        <th className="px-6 py-4">Item</th>
                        <th className="px-6 py-4">Required</th>
                        <th className="px-6 py-4">Offered</th>
                        <th className="px-6 py-4">Model Verification</th>
                        <th className="px-6 py-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.comparisons.map((item, idx) => {
                        const hasError = !item.quantity_match || !item.specification_match;
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 align-top max-w-[200px]">
                              <p className="font-medium text-slate-900 break-words">{item.item_name}</p>
                              <p className="text-xs text-slate-400 mt-1">Page {item.quotation_page_number}</p>
                            </td>
                            <td className="px-6 py-4 align-top max-w-xs">
                              <p className="text-slate-700 break-words whitespace-pre-wrap">{item.required_description}</p>
                              <p className="text-slate-500 mt-1 font-mono text-xs">Qty: {item.required_quantity}</p>
                            </td>
                            <td className="px-6 py-4 align-top max-w-xs">
                              <p className="text-slate-700 break-words whitespace-pre-wrap">{item.offered_description}</p>
                              {item.offered_model && (
                                <p className="text-indigo-600 mt-1 text-xs font-medium break-words">Model: {item.offered_model}</p>
                              )}
                              <p className="text-slate-500 mt-1 font-mono text-xs">Qty: {item.offered_quantity}</p>
                            </td>
                            <td className="px-6 py-4 align-top max-w-xs">
                              <p className="text-slate-600 text-xs leading-relaxed break-words whitespace-pre-wrap">
                                {item.model_verification_notes || 'No specific notes.'}
                              </p>
                            </td>
                            <td className="px-6 py-4 align-top max-w-[200px]">
                              {hasError ? (
                                <div className="flex flex-col space-y-2">
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 w-fit">
                                    Discrepancy
                                  </span>
                                  <p className="text-xs text-red-600 break-words whitespace-pre-wrap">{item.discrepancy_details}</p>
                                </div>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 w-fit">
                                  Match
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}
