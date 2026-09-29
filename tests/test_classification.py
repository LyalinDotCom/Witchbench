import importlib.util
from pathlib import Path
import re
import unittest

spec=importlib.util.spec_from_file_location('builder',Path(__file__).resolve().parents[1]/'scripts/build_dataset.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)


class SourceRules(unittest.TestCase):
    def test_sibling_models_are_not_aliases(self):
        aliases=builder.model_aliases({'name':'Gemini 3.8 Flash'})
        self.assertTrue(builder.has_model('3.8 Flash outperforms larger models',aliases))
        self.assertFalse(builder.has_model('Gemini 3.8 Flash Cyber outperforms them',aliases))
        self.assertFalse(builder.has_model('Gemini 3.5 Flash outperforms them',aliases))

    def test_version_numbers_are_not_evaluation_results(self):
        aliases=['gpt-5.4']
        patterns=[('terminal-bench 2.0','Terminal-Bench 2.0',re.compile(r'terminal-bench 2\.0'))]
        self.assertFalse(builder.has_result_number('GPT-5.4 is evaluated on Terminal-Bench 2.0.',patterns,aliases))
        self.assertTrue(builder.has_result_number('GPT-5.4 achieved 75.1% on Terminal-Bench 2.0.',patterns,aliases))

    def test_mask_ordinary_word_is_not_the_benchmark(self):
        patterns=[('mask','MASK',re.compile(r'\bmask\b'))]
        self.assertEqual(builder.names_in('They mask dangerous operations.',patterns),set())
        self.assertEqual(builder.names_in('Evaluation on MASK.',patterns),{'MASK'})

    def test_mythos_preview_has_a_model_alias(self):
        aliases=builder.model_aliases({'name':'Claude Mythos Preview (limited)'})
        self.assertTrue(builder.has_model('Mythos Preview achieved a higher score.',aliases))

if __name__=='__main__':unittest.main()
