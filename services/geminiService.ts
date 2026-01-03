
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

export const analyzeAnswerSheet = async (
  base64Image: string,
  totalQuestions: number,
  isKey: boolean = false
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string 
}> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // ปรับปรุง Prompt ให้เน้นย้ำเรื่องการอ่านลายมือชื่อภาษาไทยและเลขประจำตัว (OCR)
    const prompt = isKey 
      ? `OMR Vision Task: Extract exactly ${totalQuestions} marked answers from the answer key sheet. Possible values: ก, ข, ค, ง. Return as JSON.`
      : `OMR & Thai OCR Task: 
         1. Identify Student ID (numeric only) and Full Name (Thai or English) from the header area using high-precision OCR.
         2. Extract exactly ${totalQuestions} answers (ก, ข, ค, ง, null, multiple) from the marked bubbles.
         Return results in clean JSON format.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: prompt }
        ]
      },
      config: {
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  marked: { 
                    type: Type.STRING, 
                    description: "Choices: ก, ข, ค, ง, null, multiple" 
                  }
                },
                required: ["id", "marked"]
              }
            },
            studentNumber: { 
              type: Type.STRING,
              description: "Extracted digits from the ID field"
            },
            studentName: { 
              type: Type.STRING,
              description: "Extracted Thai or English name from the name field"
            }
          },
          required: ["questions"]
        }
      }
    });

    const textOutput = response.text;
    if (!textOutput) throw new Error("Empty response from AI");
    
    const data = JSON.parse(textOutput);
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        if (q.id > 0 && q.id <= totalQuestions) {
          const val = q.marked;
          if (['ก', 'ข', 'ค', 'ง', 'multiple'].includes(val)) {
            answers[q.id - 1] = val as Choice;
          } else if (val === 'null' || val === null || val === '') {
            answers[q.id - 1] = null;
          }
        }
      });
    }

    return {
      answers,
      studentId: data.studentNumber?.trim(),
      studentName: data.studentName?.trim()
    };
  } catch (err) {
    console.error("Gemini OMR OCR Error:", err);
    return { answers: [], error: "การประมวลผลล้มเหลว กรุณาตรวจสอบคุณภาพของภาพถ่าย" };
  }
};
