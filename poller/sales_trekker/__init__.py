"""
SalesTrekker — Browser automation for CRM client provisioning.

Provides the computer_use-based workflow to populate SalesTrekker
forms with OCR-extracted document fields, upload supporting documents,
and create draft applications — without ever submitting or finalising.

Usage:
    from poller.sales_trekker.provision import provision_client
    result = provision_client(fields={...}, documents=[...])
"""

from .provision import provision_client
