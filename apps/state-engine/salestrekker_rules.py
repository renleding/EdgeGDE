"""Salestrekker-specific rules — known-bug overrides and tier priorities."""
from verification import ActionType

def get_salestrekker_rules() -> dict:
    return {
        '_meta': {
            'version': '1.0',
            'description': 'Known Salestrekker SPA interaction patterns'
        },
        'tier_priorities': {
            'save_button': ['REACT', 'CDP', 'JS'],
            'combobox': ['CDP', 'KEY', 'AX'],
            'text_input': ['JS', 'KEY', 'OS'],
            'sidebar_nav': ['JS', 'CDP', 'AX'],
            'delete_button': ['CDP', 'AX', 'JS'],
            'standard_button': ['CDP', 'AX', 'JS'],
        },
        'known_bugs': {
            'radix_portal_block': {
                'symptom': 'CDP mouse events intercepted by Radix portal overlay',
                'affected_elements': ['combobox', 'dialog_buttons'],
                'workaround': 'Use KEY tier (ArrowDown+Enter) for combobox selection'
            },
            'react_props_fallback': {
                'symptom': 'Save button has no __reactProps$ in some builds',
                'affected_elements': ['save_button'],
                'workaround': 'Use addEventListener dispatch or b.click() after removing disabled'
            },
            'false_positive_save': {
                'symptom': 'Toast "Client profile updated" appears but no API call made',
                'affected_elements': ['save_button'],
                'workaround': 'Verify URL change OR network request, not just toast'
            }
        },
        'element_type_map': {
            'button': 'standard_button',
            'combobox': 'combobox',
            'text_input': 'text_input',
            'link': 'sidebar_nav',
        }
    }
